import { Router, type IRouter, type Response } from "express";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { db, businessAccountsTable, serviceCategoriesTable, sessionsTable, technicianProfilesTable, technicianSkillsTable, userRolesTable, usersTable } from "@workspace/db";
import {
  activateProvider,
  authenticateUser,
  completePasswordReset,
  createSession,
  DuplicateAccountError,
  destroySession,
  hashPassword,
  InvalidCredentialsError,
  normalizePhone,
  registerUser,
  requestPasswordReset,
  ProviderNotVerifiedError,
  setActiveMode,
  SESSION_COOKIE,
} from "../lib/auth";
import { currentUser, requireAuth, requireRole } from "../middlewares/auth";

const router: IRouter = Router();
const credentials = z.object({ phoneNumber: z.string().min(9), password: z.string().min(1).max(256) });
const providerProfile = z.object({
  bio: z.string().max(2000).optional(),
  experienceYears: z.number().int().min(0).max(80).optional(),
  serviceArea: z.string().max(120).optional(),
  hourlyRate: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  serviceRadiusKm: z.number().positive().max(500).optional(),
  emergencyEligible: z.boolean().optional(),
});
const providerProfileUpdate = providerProfile.extend({ services: z.array(z.string().min(1).max(50)).max(100).optional(), isAvailable: z.boolean().optional() });

function setSessionCookie(res: Response, token: string, expiresAt: Date) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${token}; Max-Age=${Math.floor((expiresAt.getTime() - Date.now()) / 1000)}; Expires=${expiresAt.toUTCString()}; HttpOnly; SameSite=Lax; Path=/${secure}`);
}

function matchesBootstrapToken(expected: string, provided: string | undefined) {
  if (!provided) return false;
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  return expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes);
}

const adminBootstrapBody = z.object({ phoneNumber: z.string().min(9), password: z.string().min(8).max(256), fullName: z.string().trim().min(2).max(100) });
const businessBody = z.object({ phoneNumber: z.string().min(9), password: z.string().min(8).max(256), fullName: z.string().trim().min(2).max(100), businessName: z.string().trim().min(2).max(150), registrationNumber: z.string().max(80).optional(), billingEmail: z.string().email().optional() });

router.post("/auth/register", async (req, res, next) => {
  const parsed = credentials.extend({ fullName: z.string().trim().min(2).max(100) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Provide a name, Ethiopian phone number, and password." });
  try {
    const user = await registerUser(parsed.data);
    const session = await createSession(user.id);
    setSessionCookie(res, session.rawToken, session.expiresAt);
    return res.status(201).json({ user });
  } catch (error) {
    if (error instanceof DuplicateAccountError || (typeof error === "object" && error !== null && "code" in error && error.code === "23505")) {
      return res.status(409).json({ error: "An account already exists for that phone number." });
    }
    if (error instanceof Error && (error.message.startsWith("Password must") || error.message.startsWith("Enter a valid Ethiopian"))) {
      return res.status(400).json({ error: error.message });
    }
    return next(error);
  }
});

router.post("/auth/login", async (req, res, next) => {
  const parsed = credentials.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Provide your phone number and password." });
  try {
    const user = await authenticateUser(parsed.data.phoneNumber, parsed.data.password);
    const session = await createSession(user.id);
    setSessionCookie(res, session.rawToken, session.expiresAt);
    return res.json({ user });
  } catch (error) {
    if (error instanceof InvalidCredentialsError) return res.status(401).json({ error: error.message });
    return next(error);
  }
});

router.post("/business/register", async (req, res, next) => {
  const parsed = businessBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Provide valid business account details." });
  try {
    const user = await registerUser(parsed.data);
    const [account] = await db.transaction(async (tx) => {
      await tx.insert(userRolesTable).values({ userId: user.id, role: "BUSINESS" }).onConflictDoNothing();
      return tx.insert(businessAccountsTable).values({ userId: user.id, businessName: parsed.data.businessName, registrationNumber: parsed.data.registrationNumber, billingEmail: parsed.data.billingEmail }).returning();
    });
    const session = await createSession(user.id);
    setSessionCookie(res, session.rawToken, session.expiresAt);
    return res.status(201).json({ user: { ...user, roles: [...user.roles, "BUSINESS"] }, account });
  } catch (error) {
    if (error instanceof DuplicateAccountError) return res.status(409).json({ error: error.message });
    return next(error);
  }
});

router.post("/auth/logout", async (req, res, next) => {
  try {
    const cookie = req.headers.cookie?.split(";").map((part: string) => part.trim()).find((part: string) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
    await destroySession(cookie);
    res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/`);
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

router.post("/auth/password-reset", async (req, res, next) => {
  const parsed = z.object({ phoneNumber: z.string().min(9) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Provide your phone number." });
  try {
    await requestPasswordReset(parsed.data.phoneNumber);
    return res.status(202).json({ message: "If an account exists, reset instructions will be sent." });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Enter a valid Ethiopian")) return res.status(400).json({ error: error.message });
    return next(error);
  }
});

router.post("/auth/password-reset/complete", async (req, res, next) => {
  const parsed = z.object({ token: z.string().length(64), password: z.string().min(8).max(256) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Provide a valid reset token and password." });
  try {
    await completePasswordReset(parsed.data.token, parsed.data.password);
    return res.status(204).send();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Password reset token")) return res.status(400).json({ error: error.message });
    return next(error);
  }
});

router.post("/admin/bootstrap", async (req, res, next) => {
  const expectedToken = process.env.ADMIN_BOOTSTRAP_TOKEN;
  const providedToken = req.header("x-admin-bootstrap-token") ?? req.header("X-Admin-Bootstrap-Token");

  if (!expectedToken) return res.status(503).json({ error: "Admin bootstrap is disabled." });
  if (!matchesBootstrapToken(expectedToken, providedToken)) return res.status(401).json({ error: "Invalid bootstrap token." });

  const parsed = adminBootstrapBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Provide a valid admin name, phone number, and password." });

  try {
    const phoneNumber = normalizePhone(parsed.data.phoneNumber);
    const passwordHash = await hashPassword(parsed.data.password);
    const user = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(729183426)`);
      const [admin] = await tx.select({ userId: userRolesTable.userId }).from(userRolesTable).where(eq(userRolesTable.role, "ADMIN")).limit(1);
      if (admin) throw new Error("ADMIN_BOOTSTRAP_CLOSED");
      const [created] = await tx.insert(usersTable).values({ phoneNumber, fullName: parsed.data.fullName.trim(), passwordHash, role: "CUSTOMER" }).returning();
      if (!created) throw new Error("Could not create admin account.");
      await tx.insert(userRolesTable).values({ userId: created.id, role: "CUSTOMER" }).onConflictDoNothing();
      await tx.insert(userRolesTable).values({ userId: created.id, role: "ADMIN" }).onConflictDoNothing();
      return created;
    });
    const { passwordHash: _passwordHash, role: _legacyRole, ...safeUser } = user;
    return res.status(201).json({ user: { ...safeUser, roles: ["CUSTOMER", "ADMIN"] } });
  } catch (error) {
    if (error instanceof Error && error.message === "ADMIN_BOOTSTRAP_CLOSED") return res.status(409).json({ error: "An administrator already exists; bootstrap is permanently closed." });
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") return res.status(409).json({ error: "An account already exists for that phone number." });
    if (error instanceof Error && error.message.startsWith("Enter a valid Ethiopian")) return res.status(400).json({ error: error.message });
    return next(error);
  }
});

router.get("/auth/me", requireAuth, (req, res) => res.json({ user: currentUser(req) }));

router.patch("/auth/mode", requireAuth, async (req, res, next) => {
  const parsed = z.object({ mode: z.enum(["CUSTOMER", "PROVIDER", "ADMIN"]) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose a valid account mode." });
  try {
    const user = await setActiveMode(currentUser(req)!.id, parsed.data.mode);
    return user ? res.json({ user }) : res.status(404).json({ error: "User not found." });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("You do not have permission")) return res.status(403).json({ error: error.message });
    return next(error);
  }
});

router.patch("/auth/profile", requireAuth, async (req, res, next) => {
  const parsed = z.object({ fullName: z.string().trim().min(2).max(100), avatarUrl: z.string().url().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid profile details." });
  try {
    const [user] = await db.update(usersTable).set({ ...parsed.data, updatedAt: new Date() }).where(eq(usersTable.id, currentUser(req)!.id)).returning();
    if (!user) return res.status(404).json({ error: "User not found." });
    const { passwordHash: _passwordHash, role: _legacyRole, ...safeUser } = user;
    return res.json({ user: { ...safeUser, roles: currentUser(req)!.roles } });
  } catch (error) {
    return next(error);
  }
});

router.post("/provider/activate", requireAuth, async (req, res, next) => {
  const parsed = providerProfileUpdate.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid provider profile." });
  try {
    return res.status(201).json(await activateProvider(currentUser(req)!.id, parsed.data));
  } catch (error) {
    if (error instanceof ProviderNotVerifiedError) return res.status(409).json({ error: error.message });
    if (error instanceof Error && error.message.startsWith("Choose valid")) return res.status(400).json({ error: error.message });
    return next(error);
  }
});

router.patch("/provider/profile", requireRole("PROVIDER"), async (req, res, next) => {
  const parsed = providerProfileUpdate.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid provider profile." });
  try {
    const profile = await activateProvider(currentUser(req)!.id, parsed.data);
    return profile ? res.json(profile) : res.status(404).json({ error: "Provider profile not found." });
  } catch (error) {
    if (error instanceof ProviderNotVerifiedError) return res.status(409).json({ error: error.message });
    if (error instanceof Error && error.message.startsWith("Choose valid")) return res.status(400).json({ error: error.message });
    return next(error);
  }
});

router.get("/admin/users", requireRole("ADMIN"), async (_req, res, next) => {
  try {
    const users = await db.select({ id: usersTable.id, phoneNumber: usersTable.phoneNumber, fullName: usersTable.fullName, isActive: usersTable.isActive, createdAt: usersTable.createdAt }).from(usersTable);
    const roleRows = await db.select().from(userRolesTable);
    const rolesByUser = new Map<string, string[]>();
    for (const row of roleRows) rolesByUser.set(row.userId, [...(rolesByUser.get(row.userId) ?? []), row.role]);
    return res.json(users.map((user) => ({ ...user, roles: rolesByUser.get(user.id) ?? [] })));
  } catch (error) {
    return next(error);
  }
});

router.get("/admin/providers", requireRole("ADMIN"), async (_req, res, next) => {
  try {
    const providers = await db.select({ profile: technicianProfilesTable, userId: usersTable.id, fullName: usersTable.fullName, phoneNumber: usersTable.phoneNumber, isActive: usersTable.isActive }).from(technicianProfilesTable).innerJoin(usersTable, eq(technicianProfilesTable.userId, usersTable.id));
    return res.json(providers.map(({ profile, ...user }) => ({ ...profile, ...user })));
  } catch (error) {
    return next(error);
  }
});

router.get("/admin/verifications", requireRole("ADMIN"), async (_req, res, next) => {
  try {
    const rows = await db.select({ profile: technicianProfilesTable, name: usersTable.fullName, phoneNumber: usersTable.phoneNumber }).from(technicianProfilesTable).innerJoin(usersTable, eq(technicianProfilesTable.userId, usersTable.id));
    return res.json(rows.map(({ profile, name, phoneNumber }) => ({ ...profile, name, phoneNumber })));
  } catch (error) { return next(error); }
});

router.patch("/admin/verifications/:id", requireRole("ADMIN"), async (req, res, next) => {
  const id = z.string().uuid().safeParse(req.params.id);
  const parsed = z.object({ status: z.enum(["PENDING", "UNDER_REVIEW", "VERIFIED", "SUSPENDED", "REJECTED"]) }).safeParse(req.body);
  if (!id.success || !parsed.success) return res.status(400).json({ error: "Invalid verification update." });
  try {
    const [existing] = await db.select({ isAvailable: technicianProfilesTable.isAvailable }).from(technicianProfilesTable).where(eq(technicianProfilesTable.id, id.data)).limit(1);
    const [profile] = await db.update(technicianProfilesTable).set({
      verificationStatus: parsed.data.status,
      isAvailable: parsed.data.status === "VERIFIED" ? existing?.isAvailable ?? false : false,
    }).where(eq(technicianProfilesTable.id, id.data)).returning();
    return profile ? res.json(profile) : res.status(404).json({ error: "Technician profile not found." });
  } catch (error) { return next(error); }
});

router.patch("/admin/users/:id/status", requireRole("ADMIN"), async (req, res, next) => {
  const parsed = z.object({ isActive: z.boolean() }).safeParse(req.body);
  const id = z.string().uuid().safeParse(req.params.id);
  if (!parsed.success || !id.success) return res.status(400).json({ error: "Invalid account status." });
  try {
    const user = await db.transaction(async (tx) => {
      const [updated] = await tx.update(usersTable).set({ isActive: parsed.data.isActive, updatedAt: new Date() }).where(eq(usersTable.id, id.data)).returning({ id: usersTable.id, isActive: usersTable.isActive });
      if (updated && !parsed.data.isActive) {
        await tx.delete(sessionsTable).where(eq(sessionsTable.userId, id.data));
        await tx.update(technicianProfilesTable).set({ isAvailable: false }).where(eq(technicianProfilesTable.userId, id.data));
      }
      return updated;
    });
    return user ? res.json(user) : res.status(404).json({ error: "User not found." });
  } catch (error) {
    return next(error);
  }
});

router.patch("/admin/users/:id/roles", requireRole("ADMIN"), async (req, res, next) => {
  const id = z.string().uuid().safeParse(req.params.id);
  const parsed = z.object({ role: z.enum(["CUSTOMER", "PROVIDER"]), enabled: z.boolean().default(true) }).safeParse(req.body);
  if (!id.success || !parsed.success) return res.status(400).json({ error: "Invalid role assignment." });
  try {
    const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, id.data)).limit(1);
    if (!user) return res.status(404).json({ error: "User not found." });
    if (parsed.data.enabled && parsed.data.role === "PROVIDER") {
      await activateProvider(id.data, {});
    } else if (parsed.data.enabled) {
      await db.insert(userRolesTable).values({ userId: id.data, role: "CUSTOMER" }).onConflictDoNothing();
    } else {
      await db.transaction(async (tx) => {
        await tx.delete(userRolesTable).where(and(eq(userRolesTable.userId, id.data), eq(userRolesTable.role, parsed.data.role)));
        if (parsed.data.role === "PROVIDER") await tx.update(technicianProfilesTable).set({ isAvailable: false }).where(eq(technicianProfilesTable.userId, id.data));
        const remainingRoles = await tx.select({ role: userRolesTable.role }).from(userRolesTable).where(eq(userRolesTable.userId, id.data));
        const availableModes = remainingRoles.map(({ role }) => role).filter((role): role is "CUSTOMER" | "PROVIDER" | "ADMIN" => role !== "BUSINESS");
        if (availableModes.length === 0) throw new Error("At least one account mode must remain.");
        const [target] = await tx.select({ activeMode: usersTable.activeMode }).from(usersTable).where(eq(usersTable.id, id.data)).limit(1);
        if (target && !availableModes.includes(target.activeMode)) {
          const activeMode = availableModes.includes("CUSTOMER") ? "CUSTOMER" : availableModes.includes("PROVIDER") ? "PROVIDER" : "ADMIN";
          await tx.update(usersTable).set({ activeMode, updatedAt: new Date() }).where(eq(usersTable.id, id.data));
        }
      });
    }
    return res.status(204).send();
  } catch (error) {
    if (error instanceof Error && error.message === "At least one account mode must remain.") return res.status(409).json({ error: error.message });
    return next(error);
  }
});

router.get("/provider/profile", requireRole("PROVIDER"), async (req, res, next) => {
  try {
    const [profile] = await db.select().from(technicianProfilesTable).where(eq(technicianProfilesTable.userId, currentUser(req)!.id)).limit(1);
    if (!profile) return res.status(404).json({ error: "Provider profile not found." });
    const services = await db.select({ slug: serviceCategoriesTable.slug }).from(technicianSkillsTable).innerJoin(serviceCategoriesTable, eq(technicianSkillsTable.categoryId, serviceCategoriesTable.id)).where(eq(technicianSkillsTable.technicianId, profile.id));
    return res.json({ ...profile, services: services.map(({ slug }) => slug) });
  } catch (error) {
    return next(error);
  }
});

router.get("/business/profile", requireAuth, async (req, res, next) => {
  try {
    const [account] = await db.select().from(businessAccountsTable).where(eq(businessAccountsTable.userId, currentUser(req)!.id)).limit(1);
    return account ? res.json(account) : res.status(404).json({ error: "Business account not found." });
  } catch (error) { return next(error); }
});

export default router;