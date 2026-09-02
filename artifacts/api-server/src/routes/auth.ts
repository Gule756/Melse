import { Router, type IRouter, type Response } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, businessAccountsTable, technicianProfilesTable, userRolesTable, usersTable } from "@workspace/db";
import {
  activateProvider,
  authenticateUser,
  createSession,
  destroySession,
  hashPassword,
  normalizePhone,
  registerUser,
  requestPasswordReset,
  SESSION_COOKIE,
} from "../lib/auth";
import { currentUser, requireAuth, requireRole } from "../middlewares/auth";

const router: IRouter = Router();
const credentials = z.object({ phoneNumber: z.string().min(9), password: z.string().min(1) });
const providerProfile = z.object({ bio: z.string().max(2000).optional(), experienceYears: z.number().int().min(0).max(80).optional(), serviceArea: z.string().max(120).optional(), hourlyRate: z.string().regex(/^\d+(\.\d{1,2})?$/).optional() });

function setSessionCookie(res: Response, token: string, expiresAt: Date) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${token}; Max-Age=${Math.floor((expiresAt.getTime() - Date.now()) / 1000)}; Expires=${expiresAt.toUTCString()}; HttpOnly; SameSite=Lax; Path=/${secure}`);
}

const adminBootstrapBody = z.object({ phoneNumber: z.string().min(9), password: z.string().min(8), fullName: z.string().trim().min(2).max(100) });
const businessBody = z.object({ phoneNumber: z.string().min(9), password: z.string().min(8), fullName: z.string().trim().min(2).max(100), businessName: z.string().trim().min(2).max(150), registrationNumber: z.string().max(80).optional(), billingEmail: z.string().email().optional() });

router.post("/auth/register", async (req, res) => {
  const parsed = credentials.extend({ fullName: z.string().trim().min(2).max(100) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Provide a name, Ethiopian phone number, and password." });
  try {
    const user = await registerUser(parsed.data);
    const session = await createSession(user.id);
    setSessionCookie(res, session.rawToken, session.expiresAt);
    return res.status(201).json({ user });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("duplicate") || message.includes("already exists") || (typeof error === "object" && error !== null && "code" in error && error.code === "23505")) {
      return res.status(409).json({ error: "An account already exists for that phone number." });
    }
    return res.status(400).json({ error: message || "Could not create account." });
  }
});

router.post("/auth/login", async (req, res) => {
  const parsed = credentials.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Provide your phone number and password." });
  try {
    const user = await authenticateUser(parsed.data.phoneNumber, parsed.data.password);
    const session = await createSession(user.id);
    setSessionCookie(res, session.rawToken, session.expiresAt);
    return res.json({ user });
  } catch (error) {
    return res.status(401).json({ error: error instanceof Error ? error.message : "Invalid credentials." });
  }
});

router.post("/business/register", async (req, res) => {
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
    return res.status(201).json({ user: { ...user, roles: [...user.roles, "PROVIDER"] }, account });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create business account.";
    return res.status(message.includes("already exists") || message.includes("duplicate") ? 409 : 400).json({ error: message });
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
    return next(error);
  }
});

router.post("/admin/bootstrap", async (req, res) => {
  const expectedToken = process.env.ADMIN_BOOTSTRAP_TOKEN;
  const providedToken = req.header("x-admin-bootstrap-token") ?? req.header("X-Admin-Bootstrap-Token");

  if (!expectedToken) return res.status(401).json({ error: "Admin bootstrap is disabled." });
  if (providedToken !== expectedToken) return res.status(401).json({ error: "Invalid bootstrap token." });

  const parsed = adminBootstrapBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Provide a valid admin name, phone number, and password." });

  try {
    const phoneNumber = normalizePhone(parsed.data.phoneNumber);
    const existing = await db.select().from(usersTable).where(eq(usersTable.phoneNumber, phoneNumber)).limit(1);
    if (existing.length > 0) {
      await db.insert(userRolesTable).values({ userId: existing[0].id, role: "ADMIN" }).onConflictDoNothing();
      const [updated] = await db.update(usersTable).set({ fullName: parsed.data.fullName.trim(), updatedAt: new Date() }).where(eq(usersTable.id, existing[0].id)).returning();
      return res.json({ user: { ...updated, passwordHash: undefined, roles: ["ADMIN", "CUSTOMER"] } });
    }

    const passwordHash = await hashPassword(parsed.data.password);
    const [user] = await db.transaction(async (tx) => {
      const [created] = await tx.insert(usersTable).values({ phoneNumber, fullName: parsed.data.fullName.trim(), passwordHash, role: "CUSTOMER" }).returning();
      if (!created) throw new Error("Could not create admin account.");
      await tx.insert(userRolesTable).values({ userId: created.id, role: "CUSTOMER" }).onConflictDoNothing();
      await tx.insert(userRolesTable).values({ userId: created.id, role: "ADMIN" }).onConflictDoNothing();
      return [created];
    });

    return res.json({ user: { ...user, passwordHash: undefined, roles: ["CUSTOMER", "ADMIN"] } });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Could not create admin account." });
  }
});

router.get("/auth/me", requireAuth, (req, res) => res.json({ user: currentUser(req) }));

router.patch("/auth/profile", requireAuth, async (req, res, next) => {
  const parsed = z.object({ fullName: z.string().trim().min(2).max(100), avatarUrl: z.string().url().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid profile details." });
  try {
    const [user] = await db.update(usersTable).set({ ...parsed.data, updatedAt: new Date() }).where(eq(usersTable.id, currentUser(req)!.id)).returning();
    return user ? res.json({ user: { ...user, passwordHash: undefined, roles: currentUser(req)!.roles } }) : res.status(404).json({ error: "User not found." });
  } catch (error) {
    return next(error);
  }
});

router.post("/provider/activate", requireAuth, async (req, res, next) => {
  const parsed = providerProfile.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid provider profile." });
  try {
    return res.status(201).json(await activateProvider(currentUser(req)!.id, parsed.data));
  } catch (error) {
    return next(error);
  }
});

router.get("/admin/users", requireRole("ADMIN"), async (_req, res, next) => {
  try {
    const users = await db.select({ id: usersTable.id, phoneNumber: usersTable.phoneNumber, fullName: usersTable.fullName, role: usersTable.role, isActive: usersTable.isActive, createdAt: usersTable.createdAt }).from(usersTable);
    return res.json(users);
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
    const [profile] = await db.update(technicianProfilesTable).set({ verificationStatus: parsed.data.status }).where(eq(technicianProfilesTable.id, id.data)).returning();
    return profile ? res.json(profile) : res.status(404).json({ error: "Technician profile not found." });
  } catch (error) { return next(error); }
});

router.patch("/admin/users/:id/status", requireRole("ADMIN"), async (req, res, next) => {
  const parsed = z.object({ isActive: z.boolean() }).safeParse(req.body);
  const id = z.string().uuid().safeParse(req.params.id);
  if (!parsed.success || !id.success) return res.status(400).json({ error: "Invalid account status." });
  try {
    const [user] = await db.update(usersTable).set({ isActive: parsed.data.isActive, updatedAt: new Date() }).where(eq(usersTable.id, id.data)).returning({ id: usersTable.id, isActive: usersTable.isActive });
    return user ? res.json(user) : res.status(404).json({ error: "User not found." });
  } catch (error) {
    return next(error);
  }
});

router.patch("/admin/users/:id/roles", requireRole("ADMIN"), async (req, res, next) => {
  const id = z.string().uuid().safeParse(req.params.id);
  const parsed = z.object({ role: z.enum(["CUSTOMER", "PROVIDER"]) }).safeParse(req.body);
  if (!id.success || !parsed.success) return res.status(400).json({ error: "Invalid role assignment." });
  try {
    const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, id.data)).limit(1);
    if (!user) return res.status(404).json({ error: "User not found." });
    if (parsed.data.role === "PROVIDER") await activateProvider(id.data, {});
    else await db.insert(userRolesTable).values({ userId: id.data, role: "CUSTOMER" }).onConflictDoNothing();
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

router.get("/provider/profile", requireRole("PROVIDER"), async (req, res, next) => {
  try {
    const [profile] = await db.select().from(technicianProfilesTable).where(eq(technicianProfilesTable.userId, currentUser(req)!.id)).limit(1);
    return profile ? res.json(profile) : res.status(404).json({ error: "Provider profile not found." });
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