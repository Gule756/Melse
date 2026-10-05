import { createHash, randomBytes, randomUUID, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt, inArray, isNull, notInArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  passwordResetTokensTable,
  serviceCategoriesTable,
  sessionsTable,
  technicianSkillsTable,
  technicianServicePricingTable,
  technicianProfilesTable,
  userRolesTable,
  usersTable,
  type User,
} from "@workspace/db";

const scrypt = promisify(nodeScrypt);
const SESSION_COOKIE = "melse_session";
const SESSION_DAYS = 30;

export type UserRole = "CUSTOMER" | "PROVIDER" | "ADMIN" | "BUSINESS";
export type AuthUser = Omit<User, "passwordHash" | "role"> & { roles: UserRole[] };

export class InvalidCredentialsError extends Error {}
export class DuplicateAccountError extends Error {}
export class ProviderNotVerifiedError extends Error {}

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
  return rows.map(({ role }) => role);
}

async function publicUser(user: User): Promise<AuthUser> {
  const { passwordHash: _passwordHash, role: _legacyRole, ...safeUser } = user;
  const roles = await rolesFor(user.id);
  return { ...safeUser, roles };
}

export async function registerUser(input: { phoneNumber: string; fullName: string; password: string }) {
  if (input.password.length < 8) throw new Error("Password must be at least 8 characters.");
  const phoneNumber = normalizePhone(input.phoneNumber);
  const [existingUser] = await db.select().from(usersTable).where(eq(usersTable.phoneNumber, phoneNumber)).limit(1);
  if (existingUser) throw new DuplicateAccountError("An account already exists for that phone number.");

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
  let phoneNumber: string;
  try {
    phoneNumber = normalizePhone(phoneInput);
  } catch {
    throw new InvalidCredentialsError("Invalid phone number or password.");
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.phoneNumber, phoneNumber)).limit(1);
  if (!user || !user.isActive || !(await verifyPassword(password, user.passwordHash))) throw new InvalidCredentialsError("Invalid phone number or password.");
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

export async function activateProvider(userId: string, input: { bio?: string; experienceYears?: number; serviceArea?: string; hourlyRate?: string; serviceRadiusKm?: number; emergencyEligible?: boolean; services?: string[]; isAvailable?: boolean }) {
  return db.transaction(async (tx) => {
    await tx.insert(userRolesTable).values({ userId, role: "PROVIDER" }).onConflictDoNothing();
    const [existingProfile] = await tx.select().from(technicianProfilesTable).where(eq(technicianProfilesTable.userId, userId)).limit(1);
    if (input.isAvailable === true && existingProfile?.verificationStatus !== "VERIFIED") throw new ProviderNotVerifiedError("Provider availability requires admin verification.");
    const categoryRows = input.services === undefined
      ? []
      : await tx.select({ id: serviceCategoriesTable.id, slug: serviceCategoriesTable.slug }).from(serviceCategoriesTable).where(and(
        eq(serviceCategoriesTable.isActive, true),
        inArray(serviceCategoriesTable.slug, [...new Set(input.services)]),
      ));
    if (input.services !== undefined && categoryRows.length !== new Set(input.services).size) throw new Error("Choose valid service categories.");
    const profileValues = {
      userId,
      bio: input.bio ?? existingProfile?.bio ?? undefined,
      experienceYears: input.experienceYears ?? existingProfile?.experienceYears ?? 0,
      serviceArea: input.serviceArea ?? existingProfile?.serviceArea ?? undefined,
      hourlyRate: input.hourlyRate ?? existingProfile?.hourlyRate ?? undefined,
      serviceRadiusKm: input.serviceRadiusKm === undefined ? existingProfile?.serviceRadiusKm : String(input.serviceRadiusKm),
      emergencyEligible: input.emergencyEligible ?? existingProfile?.emergencyEligible ?? false,
      isAvailable: existingProfile?.verificationStatus === "VERIFIED" ? input.isAvailable ?? existingProfile.isAvailable : false,
    };
    const [profile] = await tx.insert(technicianProfilesTable)
      .values(profileValues)
      .onConflictDoUpdate({
        target: technicianProfilesTable.userId,
        set: {
          bio: profileValues.bio,
          experienceYears: profileValues.experienceYears,
          serviceArea: profileValues.serviceArea,
          hourlyRate: profileValues.hourlyRate,
          serviceRadiusKm: profileValues.serviceRadiusKm,
          emergencyEligible: profileValues.emergencyEligible,
          isAvailable: profileValues.isAvailable,
        },
      })
      .returning();
    if (profile && input.services !== undefined) {
      await tx.delete(technicianSkillsTable).where(eq(technicianSkillsTable.technicianId, profile.id));
      if (categoryRows.length > 0) {
        await tx.delete(technicianServicePricingTable).where(and(
          eq(technicianServicePricingTable.technicianId, profile.id),
          notInArray(technicianServicePricingTable.categoryId, categoryRows.map(({ id }) => id)),
        ));
      } else {
        await tx.delete(technicianServicePricingTable).where(eq(technicianServicePricingTable.technicianId, profile.id));
      }
      if (categoryRows.length > 0) {
        await tx.insert(technicianSkillsTable).values(categoryRows.map((category) => ({ technicianId: profile.id, categoryId: category.id })));
        await tx.insert(technicianServicePricingTable).values(categoryRows.map((category) => ({
          technicianId: profile.id,
          categoryId: category.id,
          pricingModel: profileValues.hourlyRate ? "HOURLY" as const : "QUOTE" as const,
          amount: profileValues.hourlyRate ?? null,
        }))).onConflictDoNothing();
      }
    }
    return profile;
  });
}

export async function setActiveMode(userId: string, mode: "CUSTOMER" | "PROVIDER" | "ADMIN") {
  const [role] = await db.select({ role: userRolesTable.role }).from(userRolesTable).where(and(eq(userRolesTable.userId, userId), eq(userRolesTable.role, mode))).limit(1);
  if (!role) throw new Error("You do not have permission to use that mode.");
  const [user] = await db.update(usersTable).set({ activeMode: mode, updatedAt: new Date() }).where(eq(usersTable.id, userId)).returning();
  return user ? publicUser(user) : undefined;
}

export async function requestPasswordReset(phoneInput: string) {
  const phoneNumber = normalizePhone(phoneInput);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.phoneNumber, phoneNumber)).limit(1);
  if (!user) return;
  const rawToken = randomBytes(32).toString("hex");
  await db.transaction(async (tx) => {
    await tx.delete(passwordResetTokensTable).where(eq(passwordResetTokensTable.userId, user.id));
    await tx.insert(passwordResetTokensTable).values({ userId: user.id, tokenHash: hashToken(rawToken), expiresAt: new Date(Date.now() + 15 * 60 * 1000) });
  });
}

export async function completePasswordReset(token: string, password: string) {
  if (password.length < 8) throw new Error("Password must be at least 8 characters.");
  const tokenHash = hashToken(token);
  await db.transaction(async (tx) => {
    const [resetToken] = await tx.select().from(passwordResetTokensTable).where(and(
      eq(passwordResetTokensTable.tokenHash, tokenHash),
      gt(passwordResetTokensTable.expiresAt, new Date()),
      isNull(passwordResetTokensTable.usedAt),
    )).limit(1).for("update");
    if (!resetToken) throw new Error("Password reset token is invalid or expired.");
    await tx.update(usersTable).set({ passwordHash: await hashPassword(password), updatedAt: new Date() }).where(eq(usersTable.id, resetToken.userId));
    await tx.update(passwordResetTokensTable).set({ usedAt: new Date() }).where(eq(passwordResetTokensTable.id, resetToken.id));
    await tx.delete(sessionsTable).where(eq(sessionsTable.userId, resetToken.userId));
  });
}

export { SESSION_COOKIE, normalizePhone, hashPassword };