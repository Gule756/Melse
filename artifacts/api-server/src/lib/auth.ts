import { createHash, randomBytes, randomUUID, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  passwordResetTokensTable,
  sessionsTable,
  technicianProfilesTable,
  userRolesTable,
  usersTable,
  type User,
} from "@workspace/db";

const scrypt = promisify(nodeScrypt);
const SESSION_COOKIE = "melse_session";
const SESSION_DAYS = 30;

export type UserRole = "CUSTOMER" | "PROVIDER" | "ADMIN";
export type AuthUser = Omit<User, "passwordHash"> & { roles: UserRole[] };

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${derivedKey.toString("hex")}`;
}

async function verifyPassword(password: string, storedHash: string) {
  const [algorithm, salt, key] = storedHash.split(":");
  if (algorithm !== "scrypt" || !salt || !key) return false;
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(key, "hex");
  return expected.length === derivedKey.length && timingSafeEqual(expected, derivedKey);
}

function normalizePhone(phoneNumber: string) {
  const compact = phoneNumber.replace(/[\s()-]/g, "");
  if (/^09\d{8}$/.test(compact)) return `+251${compact.slice(1)}`;
  if (/^\+2519\d{8}$/.test(compact)) return compact;
  throw new Error("Enter a valid Ethiopian phone number.");
}

async function rolesFor(userId: string): Promise<UserRole[]> {
  const rows = await db.select({ role: userRolesTable.role }).from(userRolesTable).where(eq(userRolesTable.userId, userId));
  return rows.map(({ role }) => role === "BUSINESS" ? "PROVIDER" : role) as UserRole[];
}

async function publicUser(user: User): Promise<AuthUser> {
  const roles = await rolesFor(user.id);
  return { ...user, roles };
}

export async function registerUser(input: { phoneNumber: string; fullName: string; password: string }) {
  if (input.password.length < 8) throw new Error("Password must be at least 8 characters.");
  const phoneNumber = normalizePhone(input.phoneNumber);
  const [existingUser] = await db.select().from(usersTable).where(eq(usersTable.phoneNumber, phoneNumber)).limit(1);
  if (existingUser) throw new Error("An account already exists for that phone number.");

  const passwordHash = await hashPassword(input.password);
  const user = await db.transaction(async (tx) => {
    const [user] = await tx.insert(usersTable).values({ phoneNumber, fullName: input.fullName.trim(), passwordHash, role: "CUSTOMER" }).returning();
    if (!user) throw new Error("Could not create account.");
    await tx.insert(userRolesTable).values({ userId: user.id, role: "CUSTOMER" }).onConflictDoNothing();
    return user;
  });
  return publicUser(user);
}

export async function authenticateUser(phoneInput: string, password: string) {
  const phoneNumber = normalizePhone(phoneInput);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.phoneNumber, phoneNumber)).limit(1);
  if (!user || !user.isActive || !(await verifyPassword(password, user.passwordHash))) throw new Error("Invalid phone number or password.");
  return publicUser(user);
}

export async function createSession(userId: string) {
  const rawToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(sessionsTable).values({ id: randomUUID(), userId, tokenHash: hashToken(rawToken), expiresAt });
  return { rawToken, expiresAt };
}

export async function destroySession(rawToken: string | undefined) {
  if (!rawToken) return;
  await db.delete(sessionsTable).where(eq(sessionsTable.tokenHash, hashToken(rawToken)));
}

export async function userFromSession(rawToken: string | undefined) {
  if (!rawToken) return undefined;
  const rows = await db.select({ user: usersTable }).from(sessionsTable).innerJoin(usersTable, eq(sessionsTable.userId, usersTable.id)).where(and(eq(sessionsTable.tokenHash, hashToken(rawToken)), gt(sessionsTable.expiresAt, new Date()), eq(usersTable.isActive, true))).limit(1);
  const user = rows[0]?.user;
  return user ? publicUser(user) : undefined;
}

export async function activateProvider(userId: string, input: { bio?: string; experienceYears?: number; serviceArea?: string; hourlyRate?: string }) {
  return db.transaction(async (tx) => {
    await tx.insert(userRolesTable).values({ userId, role: "PROVIDER" }).onConflictDoNothing();
    const profileValues = {
      userId,
      bio: input.bio,
      experienceYears: input.experienceYears ?? 0,
      serviceArea: input.serviceArea,
      hourlyRate: input.hourlyRate,
      verificationStatus: "VERIFIED" as const,
      isAvailable: true,
    };
    const [profile] = await tx.insert(technicianProfilesTable)
      .values(profileValues)
      .onConflictDoUpdate({
        target: technicianProfilesTable.userId,
        set: {
          bio: input.bio,
          experienceYears: input.experienceYears ?? 0,
          serviceArea: input.serviceArea,
          hourlyRate: input.hourlyRate,
          verificationStatus: "VERIFIED",
          isAvailable: true,
        },
      })
      .returning();
    return profile;
  });
}

export async function requestPasswordReset(phoneInput: string) {
  const phoneNumber = normalizePhone(phoneInput);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.phoneNumber, phoneNumber)).limit(1);
  if (!user) return;
  const rawToken = randomBytes(32).toString("hex");
  await db.insert(passwordResetTokensTable).values({ userId: user.id, tokenHash: hashToken(rawToken), expiresAt: new Date(Date.now() + 15 * 60 * 1000) });
  // Delivery is intentionally outside this phase; callers receive the same response for unknown users.
}

export { SESSION_COOKIE, normalizePhone, hashPassword };