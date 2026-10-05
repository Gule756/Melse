import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import app from "../src/app";
import { db, passwordResetTokensTable, usersTable } from "@workspace/db";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const apiDirectory = path.resolve(testDirectory, "..");
const workspaceDirectory = path.resolve(testDirectory, "../../..");

async function resetDatabase() {
  await db.execute(sql`TRUNCATE TABLE "user_roles", "sessions", "password_reset_tokens", "bookings", "booking_status_history", "reviews", "service_guarantees", "payments", "service_requests", "customer_addresses", "technician_skills", "technician_profiles", "pricing_rules", "service_categories", "users" RESTART IDENTITY CASCADE;`);
  await db.execute(sql`
    INSERT INTO service_categories (id, name, slug, icon_name, description)
    VALUES
      ('00000000-0000-0000-0000-000000000001', 'Appliance repair', 'appliance-repair', 'appliance', 'Fridges, washing machines, cookers and more'),
      ('00000000-0000-0000-0000-000000000002', 'Electrician', 'electrician', 'electric', 'Safe, reliable help for electrical problems'),
      ('00000000-0000-0000-0000-000000000003', 'Plumber', 'plumber', 'plumber', 'Leaks, drains, faucets and installations'),
      ('00000000-0000-0000-0000-000000000004', 'AC & refrigeration', 'ac-refrigeration', 'ac', 'Keep your home cool and comfortable'),
      ('00000000-0000-0000-0000-000000000005', 'Cleaning', 'cleaning', 'cleaning', 'A fresh, cared-for home without the hassle')
    ON CONFLICT (slug) DO NOTHING;
  `);
  await db.execute(sql`
    INSERT INTO pricing_rules (id, category_id, base_price_min, base_price_max, emergency_fee, platform_commission_rate)
    SELECT gen_random_uuid(), id, CASE slug WHEN 'electrician' THEN 350 ELSE 400 END, CASE slug WHEN 'electrician' THEN 650 WHEN 'cleaning' THEN 1000 ELSE 700 END, 150, 0.15
    FROM service_categories
    WHERE slug IN ('appliance-repair', 'electrician', 'plumber', 'ac-refrigeration', 'cleaning')
    ON CONFLICT DO NOTHING;
  `);
}

async function seedCatalog() {
  await db.execute(sql`
    INSERT INTO service_categories (id, name, slug, icon_name, description)
    VALUES
      ('00000000-0000-0000-0000-000000000001', 'Appliance repair', 'appliance-repair', 'appliance', 'Fridges, washing machines, cookers and more'),
      ('00000000-0000-0000-0000-000000000002', 'Electrician', 'electrician', 'electric', 'Safe, reliable help for electrical problems'),
      ('00000000-0000-0000-0000-000000000003', 'Plumber', 'plumber', 'plumber', 'Leaks, drains, faucets and installations'),
      ('00000000-0000-0000-0000-000000000004', 'AC & refrigeration', 'ac-refrigeration', 'ac', 'Keep your home cool and comfortable'),
      ('00000000-0000-0000-0000-000000000005', 'Cleaning', 'cleaning', 'cleaning', 'A fresh, cared-for home without the hassle')
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, icon_name = EXCLUDED.icon_name, description = EXCLUDED.description;
  `);

  await db.execute(sql`
    INSERT INTO pricing_rules (category_id, base_price_min, base_price_max, emergency_fee, platform_commission_rate)
    SELECT c.id,
           CASE c.slug WHEN 'electrician' THEN 350 ELSE 400 END,
           CASE c.slug WHEN 'electrician' THEN 650 WHEN 'cleaning' THEN 1000 ELSE 700 END,
           150,
           0.15
    FROM service_categories c
    WHERE c.slug IN ('appliance-repair', 'electrician', 'plumber', 'ac-refrigeration', 'cleaning')
      AND NOT EXISTS (
        SELECT 1 FROM pricing_rules pr WHERE pr.category_id = c.id
      );
  `);
}

function authCookie(response: request.Response) {
  const setCookie = response.headers["set-cookie"];
  if (!setCookie) return undefined;
  return Array.isArray(setCookie) ? setCookie[0] : setCookie;
}

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate an API test port.");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function startApiServer(port: number): Promise<ChildProcess> {
  const child = spawn(process.execPath, [path.resolve(apiDirectory, "dist/index.mjs")], {
    cwd: workspaceDirectory,
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL, PORT: String(port), NODE_ENV: "test" },
    stdio: "ignore",
  });
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15_000) {
    if (child.exitCode !== null) throw new Error(`API test server exited during startup (code ${child.exitCode}).`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/healthz`);
      if (response.ok) return child;
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  await stopApiServer(child);
  throw new Error("API test server did not become healthy.");
}

async function stopApiServer(child: ChildProcess) {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function bootstrapAdmin(phoneNumber: string, name: string) {
  const created = await request(app)
    .post("/api/admin/bootstrap")
    .set("x-admin-bootstrap-token", "dev-bootstrap-secret")
    .send({ phoneNumber, password: "StrongPassword123!", fullName: name });
  expect(created.status).toBe(201);
  const login = await request(app).post("/api/auth/login").send({ phoneNumber, password: "StrongPassword123!" });
  expect(login.status).toBe(200);
  return authCookie(login)!;
}

async function verifyProvider(profileId: string, providerCookie: string, adminCookie: string) {
  const verification = await request(app)
    .patch(`/api/admin/verifications/${profileId}`)
    .set("Cookie", adminCookie)
    .send({ status: "VERIFIED" });
  expect(verification.status).toBe(200);
  const availability = await request(app)
    .patch("/api/provider/profile")
    .set("Cookie", providerCookie)
    .send({ isAvailable: true });
  expect(availability.status).toBe(200);
  expect(availability.body.isAvailable).toBe(true);
}

describe.skipIf(!process.env.TEST_DATABASE_URL)("Melse auth and authorization", () => {
  beforeEach(async () => {
    await resetDatabase();
    await seedCatalog();
    process.env.NODE_ENV = "test";
    process.env.ADMIN_BOOTSTRAP_TOKEN = "dev-bootstrap-secret";
  });

  it("registers a customer, logs in, fetches me, and logs out", async () => {
    const register = await request(app)
      .post("/api/auth/register")
      .send({ fullName: "Customer One", phoneNumber: "+251911234567", password: "hunter2pass" });

    expect(register.status).toBe(201);
    expect(register.body.user.roles).toContain("CUSTOMER");
    expect(register.body.user).not.toHaveProperty("passwordHash");

    const cookie = authCookie(register);
    expect(cookie).toBeTruthy();

    const me = await request(app).get("/api/auth/me").set("Cookie", cookie!);
    expect(me.status).toBe(200);
    expect(me.body.user.fullName).toBe("Customer One");
    expect(me.body.user).not.toHaveProperty("passwordHash");

    const login = await request(app)
      .post("/api/auth/login")
      .send({ phoneNumber: "+251911234567", password: "hunter2pass" });

    expect(login.status).toBe(200);
    expect(login.body.user.phoneNumber).toBe("+251911234567");
    expect(login.body.user).not.toHaveProperty("passwordHash");

    const logout = await request(app).post("/api/auth/logout").set("Cookie", authCookie(login)!);
    expect(logout.status).toBe(204);

    const meAfterLogout = await request(app).get("/api/auth/me").set("Cookie", authCookie(login)!);
    expect(meAfterLogout.status).toBe(401);
  });

  it("rejects invalid password and duplicate registration", async () => {
    await request(app)
      .post("/api/auth/register")
      .send({ fullName: "Customer One", phoneNumber: "+251911234567", password: "hunter2pass" });

    const badLogin = await request(app)
      .post("/api/auth/login")
      .send({ phoneNumber: "+251911234567", password: "wrongpass" });
    expect(badLogin.status).toBe(401);

    const duplicate = await request(app)
      .post("/api/auth/register")
      .send({ fullName: "Customer Two", phoneNumber: "+251911234567", password: "anotherpass" });
    expect(duplicate.status).toBe(409);
  });

  it("requires authentication for protected endpoints and rejects invalid sessions", async () => {
    const unauth = await request(app).get("/api/auth/me");
    expect(unauth.status).toBe(401);

    const invalid = await request(app).get("/api/auth/me").set("Cookie", "melse_session=bad-token");
    expect(invalid.status).toBe(401);
  });

  it("stores password reset tokens hashed without revealing account existence", async () => {
    await request(app).post("/api/auth/register").send({ fullName: "Reset User", phoneNumber: "+251911234570", password: "hunter2pass" });
    const known = await request(app).post("/api/auth/password-reset").send({ phoneNumber: "+251911234570" });
    const unknown = await request(app).post("/api/auth/password-reset").send({ phoneNumber: "+251911234571" });
    expect(known.status).toBe(202);
    expect(known.body).toEqual(unknown.body);
    const tokens = await db.select().from(passwordResetTokensTable);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("consumes a password reset token once and invalidates existing sessions", async () => {
    const registration = await request(app)
      .post("/api/auth/register")
      .send({ fullName: "Reset Completion", phoneNumber: "+251911234572", password: "hunter2pass" });
    const resetToken = randomBytes(32).toString("hex");
    await db.insert(passwordResetTokensTable).values({
      userId: registration.body.user.id,
      tokenHash: createHash("sha256").update(resetToken).digest("hex"),
      expiresAt: new Date(Date.now() + 60_000),
    });

    const completed = await request(app).post("/api/auth/password-reset/complete").send({ token: resetToken, password: "newPassword123" });
    expect(completed.status).toBe(204);
    const oldSession = await request(app).get("/api/auth/me").set("Cookie", authCookie(registration)!);
    expect(oldSession.status).toBe(401);
    const login = await request(app).post("/api/auth/login").send({ phoneNumber: "+251911234572", password: "newPassword123" });
    expect(login.status).toBe(200);

    const replay = await request(app).post("/api/auth/password-reset/complete").send({ token: resetToken, password: "anotherPassword123" });
    expect(replay.status).toBe(400);
  });

  it("supports customer and provider registration and role-based access", async () => {
    const customer = await request(app)
      .post("/api/auth/register")
      .send({ fullName: "Customer One", phoneNumber: "+251911234567", password: "hunter2pass" });
    expect(customer.status).toBe(201);

    const providerReg = await request(app)
      .post("/api/auth/register")
      .send({ fullName: "Provider One", phoneNumber: "+251922334455", password: "providerpass" });
    expect(providerReg.status).toBe(201);

    const providerCookie = authCookie(providerReg)!;
    const providerActivate = await request(app)
      .post("/api/provider/activate")
      .set("Cookie", providerCookie)
      .send({ bio: "Skilled technician", experienceYears: 5, serviceArea: "Addis Ababa", hourlyRate: "450" });
    expect(providerActivate.status).toBe(201);

    const customerRequest = await request(app)
      .post("/api/service-requests")
      .set("Cookie", authCookie(customer)!)
      .send({
        serviceSlug: "electrician",
        urgency: "Standard",
        problem: "Power outage",
        description: "My breaker tripped.",
        address: "Bole Road",
      });

    expect(customerRequest.status).toBe(201);

    const adminRole = await request(app)
      .patch(`/api/admin/users/${customer.body.user.id}/roles`)
      .set("Cookie", authCookie(customer)!)
      .send({ role: "PROVIDER" });
    expect(adminRole.status).toBe(403);

    const adminBootstrap = await request(app)
      .post("/api/admin/bootstrap")
      .set("x-admin-bootstrap-token", "dev-bootstrap-secret")
      .send({ phoneNumber: "+251933445566", password: "StrongPassword123!", fullName: "Admin User" });
    expect(adminBootstrap.status).toBe(201);

    const adminLogin = await request(app)
      .post("/api/auth/login")
      .send({ phoneNumber: "+251933445566", password: "StrongPassword123!" });
    expect(adminLogin.status).toBe(200);
    expect(adminLogin.body.user.roles).toContain("ADMIN");
    const adminCookie = authCookie(adminLogin)!;

    const adminList = await request(app)
      .get("/api/admin/users")
      .set("Cookie", adminCookie);
    expect(adminList.status).toBe(200);
    const grantProvider = await request(app)
      .patch(`/api/admin/users/${customer.body.user.id}/roles`)
      .set("Cookie", adminCookie)
      .send({ role: "PROVIDER", enabled: true });
    expect(grantProvider.status).toBe(204);
    const switchedMode = await request(app)
      .patch("/api/auth/mode")
      .set("Cookie", authCookie(customer)!)
      .send({ mode: "PROVIDER" });
    expect(switchedMode.status).toBe(200);
    expect(switchedMode.body.user.roles).toEqual(expect.arrayContaining(["CUSTOMER", "PROVIDER"]));

    const revokeProvider = await request(app)
      .patch(`/api/admin/users/${customer.body.user.id}/roles`)
      .set("Cookie", adminCookie)
      .send({ role: "PROVIDER", enabled: false });
    expect(revokeProvider.status).toBe(204);
    const returnedToCustomerMode = await request(app).get("/api/auth/me").set("Cookie", authCookie(customer)!);
    expect(returnedToCustomerMode.body.user.activeMode).toBe("CUSTOMER");
    expect(returnedToCustomerMode.body.user.roles).not.toContain("PROVIDER");

    const suspended = await request(app)
      .patch(`/api/admin/users/${customer.body.user.id}/status`)
      .set("Cookie", adminCookie)
      .send({ isActive: false });
    expect(suspended.status).toBe(200);
    const suspendedSession = await request(app).get("/api/auth/me").set("Cookie", authCookie(customer)!);
    expect(suspendedSession.status).toBe(401);
  });

  it("keeps a combined customer-provider identity pending until an admin verifies it", async () => {
    const registration = await request(app)
      .post("/api/auth/register")
      .send({ fullName: "Dual Mode User", phoneNumber: "+251911234568", password: "hunter2pass" });
    const userCookie = authCookie(registration)!;

    const unauthorizedMode = await request(app)
      .patch("/api/auth/mode")
      .set("Cookie", userCookie)
      .send({ mode: "PROVIDER" });
    expect(unauthorizedMode.status).toBe(403);

    const activation = await request(app)
      .post("/api/provider/activate")
      .set("Cookie", userCookie)
      .send({ bio: "Appliance repair specialist", experienceYears: 4, serviceArea: "Bole", hourlyRate: "500", services: ["appliance-repair", "electrician"] });
    expect(activation.status).toBe(201);
    expect(activation.body.verificationStatus).toBe("PENDING");
    expect(activation.body.isAvailable).toBe(false);
    expect(activation.body).not.toHaveProperty("passwordHash");

    const enabledBeforeVerification = await request(app)
      .patch("/api/provider/profile")
      .set("Cookie", userCookie)
      .send({ isAvailable: true });
    expect(enabledBeforeVerification.status).toBe(409);

    const providerMode = await request(app)
      .patch("/api/auth/mode")
      .set("Cookie", userCookie)
      .send({ mode: "PROVIDER" });
    expect(providerMode.status).toBe(200);
    expect(providerMode.body.user.activeMode).toBe("PROVIDER");
    expect(providerMode.body.user.roles).toEqual(expect.arrayContaining(["CUSTOMER", "PROVIDER"]));

    const adminCookie = await bootstrapAdmin("+251911234569", "Identity Admin");
    await verifyProvider(activation.body.id, userCookie, adminCookie);
    const profile = await request(app).get("/api/provider/profile").set("Cookie", userCookie);
    expect(profile.status).toBe(200);
    expect(profile.body.services).toEqual(expect.arrayContaining(["appliance-repair", "electrician"]));

    const providers = await request(app).get("/api/admin/providers").set("Cookie", adminCookie);
    expect(providers.status).toBe(200);
    expect(providers.body.some((entry: { userId: string }) => entry.userId === registration.body.user.id)).toBe(true);

    const available = await request(app).patch("/api/provider/profile").set("Cookie", userCookie).send({ isAvailable: true });
    expect(available.status).toBe(200);
    const listedBeforeSuspension = await request(app).get("/api/technicians").set("Cookie", adminCookie);
    expect(listedBeforeSuspension.body.some((provider: { id: string }) => provider.id === activation.body.id)).toBe(true);

    const suspended = await request(app).patch(`/api/admin/users/${registration.body.user.id}/status`).set("Cookie", adminCookie).send({ isActive: false });
    expect(suspended.status).toBe(200);
    const revokedSession = await request(app).get("/api/provider/profile").set("Cookie", userCookie);
    expect(revokedSession.status).toBe(401);

    const reactivated = await request(app).patch(`/api/admin/users/${registration.body.user.id}/status`).set("Cookie", adminCookie).send({ isActive: true });
    expect(reactivated.status).toBe(200);
    const login = await request(app).post("/api/auth/login").send({ phoneNumber: "+251911234568", password: "hunter2pass" });
    const reactivatedProfile = await request(app).get("/api/provider/profile").set("Cookie", authCookie(login)!);
    expect(reactivatedProfile.body.isAvailable).toBe(false);
    const listedAfterReactivation = await request(app).get("/api/technicians").set("Cookie", adminCookie);
    expect(listedAfterReactivation.body.some((provider: { id: string }) => provider.id === activation.body.id)).toBe(false);
  });

  it("blocks cross-user access to requests and booking status changes", async () => {
    const customerA = await request(app)
      .post("/api/auth/register")
      .send({ fullName: "Customer A", phoneNumber: "+251911000001", password: "hunter2pass" });
    const customerB = await request(app)
      .post("/api/auth/register")
      .send({ fullName: "Customer B", phoneNumber: "+251911000002", password: "hunter2pass" });

    const requestA = await request(app)
      .post("/api/service-requests")
      .set("Cookie", authCookie(customerA)!)
      .send({
        serviceSlug: "plumber",
        urgency: "Standard",
        problem: "Leak",
        description: "Kitchen sink leak.",
        address: "Megenagna",
      });

    expect(requestA.status).toBe(201);
    const listB = await request(app).get("/api/service-requests").set("Cookie", authCookie(customerB)!);
    expect(listB.status).toBe(200);
    expect(listB.body.some((item: { id: string }) => item.id === requestA.body.id)).toBe(false);

    const provider = await request(app)
      .post("/api/auth/register")
      .send({ fullName: "Provider A", phoneNumber: "+251922000001", password: "providerpass" });
    const providerCookie = authCookie(provider)!;
    const activation = await request(app)
      .post("/api/provider/activate")
      .set("Cookie", providerCookie)
      .send({ bio: "Licensed plumber", experienceYears: 7, serviceArea: "Addis Ababa", hourlyRate: "400" });
    const adminCookie = await bootstrapAdmin("+251933000001", "Test Admin");
    await verifyProvider(activation.body.id, providerCookie, adminCookie);

    const booking = await request(app)
      .post("/api/bookings")
      .set("Cookie", authCookie(customerA)!)
      .send({ requestId: requestA.body.id, technicianId: provider.body.user.id });
    expect(booking.status).toBe(201);

    const forbidden = await request(app)
      .patch(`/api/bookings/${booking.body.id}/status`)
      .set("Cookie", authCookie(customerB)!)
      .send({ status: "CANCELLED" });
    expect(forbidden.status).toBe(403);
  });

  it("enforces provider ownership checks for profile and jobs", async () => {
    const providerA = await request(app)
      .post("/api/auth/register")
      .send({ fullName: "Provider A", phoneNumber: "+251922000011", password: "providerpass" });
    const providerB = await request(app)
      .post("/api/auth/register")
      .send({ fullName: "Provider B", phoneNumber: "+251922000012", password: "providerpass" });

    const aCookie = authCookie(providerA)!;
    const bCookie = authCookie(providerB)!;

    const actA = await request(app)
      .post("/api/provider/activate")
      .set("Cookie", aCookie)
      .send({ bio: "Provider A profile", experienceYears: 4, serviceArea: "Addis Ababa", hourlyRate: "480" });
    const actB = await request(app)
      .post("/api/provider/activate")
      .set("Cookie", bCookie)
      .send({ bio: "Provider B profile", experienceYears: 6, serviceArea: "Bole", hourlyRate: "520" });
    expect(actA.status).toBe(201);
    expect(actB.status).toBe(201);

    const profileB = await request(app).get("/api/provider/profile").set("Cookie", bCookie);
    expect(profileB.status).toBe(200);
    expect(profileB.body.bio).toBe("Provider B profile");

    const myProfileA = await request(app).get("/api/provider/profile").set("Cookie", aCookie);
    expect(myProfileA.status).toBe(200);
    expect(myProfileA.body.bio).toBe("Provider A profile");
    expect(myProfileA.body.userId).not.toBe(profileB.body.userId);
  });

  it("creates an idempotent provider offer, enforces booking ownership, and persists authorized booking chat", async () => {
    const customer = await request(app).post("/api/auth/register")
      .send({ fullName: "Marketplace Customer", phoneNumber: "+251911800001", password: "customerpass" });
    const otherCustomer = await request(app).post("/api/auth/register")
      .send({ fullName: "Other Customer", phoneNumber: "+251911800002", password: "customerpass" });
    const provider = await request(app).post("/api/auth/register")
      .send({ fullName: "Marketplace Provider", phoneNumber: "+251922800001", password: "providerpass" });
    const providerCookie = authCookie(provider)!;
    const profile = await request(app).post("/api/provider/activate")
      .set("Cookie", providerCookie)
      .send({ bio: "Licensed plumber", experienceYears: 5, serviceArea: "Bole", hourlyRate: "450", services: ["plumber"] });
    expect(profile.status).toBe(201);
    const adminCookie = await bootstrapAdmin("+251933800001", "Marketplace Admin");
    await verifyProvider(profile.body.id, providerCookie, adminCookie);

    const requestBody = {
      serviceSlug: "plumber",
      urgency: "Standard",
      problem: "Kitchen leak",
      description: "Water is leaking under the kitchen sink.",
      address: "Bole Road",
    };
    const created = await request(app).post("/api/service-requests")
      .set("Cookie", authCookie(customer)!)
      .set("Idempotency-Key", "marketplace-request-0001")
      .send(requestBody);
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("SEARCHING");
    const retry = await request(app).post("/api/service-requests")
      .set("Cookie", authCookie(customer)!)
      .set("Idempotency-Key", "marketplace-request-0001")
      .send(requestBody);
    expect(retry.status).toBe(200);
    expect(retry.body.id).toBe(created.body.id);

    const inbox = await request(app).get("/api/provider/requests").set("Cookie", providerCookie);
    expect(inbox.status).toBe(200);
    expect(inbox.body.some((offer: { id: string }) => offer.id === created.body.id)).toBe(true);
    const accepted = await request(app).post(`/api/provider/requests/${created.body.id}/respond`)
      .set("Cookie", providerCookie)
      .send({ decision: "ACCEPT", quotedPrice: 650 });
    expect(accepted.status).toBe(200);
    const bookingId = accepted.body.bookingId as string;
    const customerBooking = await request(app).get(`/api/bookings/${bookingId}`).set("Cookie", authCookie(customer)!);
    expect(customerBooking.status).toBe(200);
    expect(customerBooking.body.finalPrice).toBe(650);

    const crossCustomerBooking = await request(app).get(`/api/bookings/${bookingId}`).set("Cookie", authCookie(otherCustomer)!);
    expect(crossCustomerBooking.status).toBe(404);
    const providerJobs = await request(app).get("/api/provider/bookings").set("Cookie", providerCookie);
    expect(providerJobs.status).toBe(200);
    expect(providerJobs.body.some((job: { id: string }) => job.id === bookingId)).toBe(true);

    const conversations = await request(app).get("/api/conversations").set("Cookie", authCookie(customer)!);
    expect(conversations.status).toBe(200);
    const conversationId = conversations.body.find((conversation: { bookingId: string }) => conversation.bookingId === bookingId).conversationId;
    const sent = await request(app).post(`/api/conversations/${conversationId}/messages`)
      .set("Cookie", authCookie(customer)!)
      .send({ body: "The water is still leaking." });
    expect(sent.status).toBe(201);
    const forbiddenMessages = await request(app).get(`/api/conversations/${conversationId}/messages`)
      .set("Cookie", authCookie(otherCustomer)!);
    expect(forbiddenMessages.status).toBe(404);
    const received = await request(app).get(`/api/conversations/${conversationId}/messages`)
      .set("Cookie", providerCookie);
    expect(received.status).toBe(200);
    expect(received.body.some((message: { body: string }) => message.body === "The water is still leaking.")).toBe(true);

    const forgedPayment = await request(app).patch(`/api/bookings/${bookingId}/status`)
      .set("Cookie", authCookie(customer)!)
      .send({ status: "PAID" });
    expect(forgedPayment.status).toBe(409);
  });

  it("requires a bootstrap token for admin creation and rejects non-admin access", async () => {
    const customer = await request(app)
      .post("/api/auth/register")
      .send({ fullName: "Normal User", phoneNumber: "+251911555111", password: "hunter2pass" });
    const provider = await request(app)
      .post("/api/auth/register")
      .send({ fullName: "Provider User", phoneNumber: "+251911555112", password: "providerpass" });

    const routine = await request(app)
      .post("/api/admin/bootstrap")
      .send({ phoneNumber: "+251900000000", password: "NotARealAdminPassword", fullName: "Bad User" });
    expect(routine.status).toBe(401);

    const customerForbidden = await request(app)
      .get("/api/admin/users")
      .set("Cookie", authCookie(customer)!);
    expect(customerForbidden.status).toBe(403);

    const providerForbidden = await request(app)
      .get("/api/admin/users")
      .set("Cookie", authCookie(provider)!);
    expect(providerForbidden.status).toBe(403);

    const bootstrap = await request(app)
      .post("/api/admin/bootstrap")
      .set("x-admin-bootstrap-token", "dev-bootstrap-secret")
      .send({ phoneNumber: "+251911555113", password: "StrongPassword123!", fullName: "Bootstrap Admin" });
    expect(bootstrap.status).toBe(201);
    const attemptedPromotion = await request(app)
      .post("/api/admin/bootstrap")
      .set("x-admin-bootstrap-token", "dev-bootstrap-secret")
      .send({ phoneNumber: "+251911555111", password: "StrongPassword123!", fullName: "Normal User" });
    expect(attemptedPromotion.status).toBe(409);
  });

  it("persists users and sessions after restarting the API process", async () => {
    const port = await freePort();
    let child = await startApiServer(port);
    try {
      const origin = `http://127.0.0.1:${port}`;
      const created = await fetch(`${origin}/api/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fullName: "Persistent User", phoneNumber: "+251911300001", password: "hunter2pass" }),
      });
      expect(created.status).toBe(201);
      const cookie = created.headers.get("set-cookie")?.split(";")[0];
      expect(cookie).toBeTruthy();
      const user = (await created.json()).user;

      const persistedUser = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, user.id)).limit(1);
      expect(persistedUser[0]?.id).toBe(user.id);
      await stopApiServer(child);

      child = await startApiServer(port);
      const afterRestart = await fetch(`${origin}/api/auth/me`, { headers: { Cookie: cookie! } });
      expect(afterRestart.status).toBe(200);
      expect((await afterRestart.json()).user.id).toBe(user.id);
    } finally {
      await stopApiServer(child);
    }
  });

  it("creates a business account and ranks matched providers", async () => {
    const business = await request(app)
      .post("/api/business/register")
      .send({ fullName: "Business Owner", phoneNumber: "+251911300002", password: "businesspass", businessName: "Aster Foods", billingEmail: "billing@aster.example" });

    expect(business.status).toBe(201);
    expect(business.body.account.businessName).toBe("Aster Foods");

    const profile = await request(app).get("/api/business/profile").set("Cookie", authCookie(business)!);
    expect(profile.status).toBe(200);
    expect(profile.body.billingEmail).toBe("billing@aster.example");

    const provider = await request(app)
      .post("/api/auth/register")
      .send({ fullName: "Available Provider", phoneNumber: "+251911300003", password: "providerpass" });
    const providerCookie = authCookie(provider)!;
    const providerProfile = await request(app).post("/api/provider/activate").set("Cookie", providerCookie).send({ serviceArea: "Bole", services: ["electrician"] });
    const adminCookie = await bootstrapAdmin("+251911300011", "Provider Reviewer");
    await verifyProvider(providerProfile.body.id, providerCookie, adminCookie);

    const technicians = await request(app).get("/api/technicians?serviceSlug=electrician").set("Cookie", authCookie(business)!);
    expect(technicians.status).toBe(200);
    expect(technicians.body[0].distance).toBe("Matched to your service");
  });

  it("stores customer assets and creates maintenance recommendations", async () => {
    const customer = await request(app)
      .post("/api/auth/register")
      .send({ fullName: "Asset Owner", phoneNumber: "+251911300004", password: "hunter2pass" });

    const asset = await request(app)
      .post("/api/assets")
      .set("Cookie", authCookie(customer)!)
      .send({ categorySlug: "electrician", name: "Kitchen circuit", lastServicedAt: "2025-01-01T00:00:00.000Z" });

    expect(asset.status).toBe(201);
    const assets = await request(app).get("/api/assets").set("Cookie", authCookie(customer)!);
    expect(assets.status).toBe(200);
    expect(assets.body[0].category).toBe("electrician");

    const recommendations = await request(app).get("/api/maintenance/recommendations").set("Cookie", authCookie(customer)!);
    expect(recommendations.status).toBe(200);
    expect(recommendations.body[0].assetId).toBe(asset.body.id);
  });

  it("provides transparent support guidance and urgent escalation", async () => {
    const customer = await request(app)
      .post("/api/auth/register")
      .send({ fullName: "Support User", phoneNumber: "+251911300005", password: "hunter2pass" });

    const guidance = await request(app)
      .post("/api/support/assist")
      .set("Cookie", authCookie(customer)!)
      .send({ message: "What is the status of my booking?" });
    expect(guidance.status).toBe(200);
    expect(guidance.body.mode).toBe("rules");
    expect(guidance.body.topic).toBe("booking");
    expect(guidance.body.needsHuman).toBe(false);

    const urgent = await request(app)
      .post("/api/support/assist")
      .set("Cookie", authCookie(customer)!)
      .send({ message: "There is smoke and danger near the socket." });
    expect(urgent.status).toBe(200);
    expect(urgent.body.needsHuman).toBe(true);
  });

  it("allows admins to review providers, edit pricing, and view dispatch", async () => {
    const provider = await request(app).post("/api/auth/register").send({ fullName: "Review Provider", phoneNumber: "+251911300006", password: "providerpass" });
    const activation = await request(app).post("/api/provider/activate").set("Cookie", authCookie(provider)!).send({ serviceArea: "Bole" });
    const admin = await request(app).post("/api/admin/bootstrap").set("x-admin-bootstrap-token", "dev-bootstrap-secret").send({ phoneNumber: "+251911300007", password: "adminpass", fullName: "Ops Admin" });
    const adminLogin = await request(app).post("/api/auth/login").send({ phoneNumber: "+251911300007", password: "adminpass" });
    const adminCookie = authCookie(adminLogin)!;

    const queue = await request(app).get("/api/admin/verifications").set("Cookie", adminCookie);
    expect(queue.status).toBe(200);
    const review = await request(app).patch(`/api/admin/verifications/${activation.body.id}`).set("Cookie", adminCookie).send({ status: "UNDER_REVIEW" });
    expect(review.status).toBe(200);

    const pricing = await request(app).get("/api/admin/pricing").set("Cookie", adminCookie);
    expect(pricing.status).toBe(200);
    const updatedPricing = await request(app).patch(`/api/admin/pricing/${pricing.body[0].id}`).set("Cookie", adminCookie).send({ basePriceMin: 300, basePriceMax: 600, emergencyFee: 200, platformCommissionRate: 0.2 });
    expect(updatedPricing.status).toBe(200);

    const dispatch = await request(app).get("/api/admin/dispatch").set("Cookie", adminCookie);
    expect(dispatch.status).toBe(200);
  });

  it("keeps unconfigured payments pending and protected by booking ownership", async () => {
    const customer = await request(app).post("/api/auth/register").send({ fullName: "Payment User", phoneNumber: "+251911300008", password: "hunter2pass" });
    const provider = await request(app).post("/api/auth/register").send({ fullName: "Payment Provider", phoneNumber: "+251911300009", password: "providerpass" });
    const providerCookie = authCookie(provider)!;
    const activation = await request(app).post("/api/provider/activate").set("Cookie", providerCookie).send({ serviceArea: "Bole" });
    const adminCookie = await bootstrapAdmin("+251911300012", "Payment Test Admin");
    await verifyProvider(activation.body.id, providerCookie, adminCookie);
    const serviceRequest = await request(app).post("/api/service-requests").set("Cookie", authCookie(customer)!).send({ serviceSlug: "electrician", urgency: "Standard", problem: "Socket issue", description: "One socket is loose.", address: "Bole Road" });
    const booking = await request(app).post("/api/bookings").set("Cookie", authCookie(customer)!).send({ requestId: serviceRequest.body.id, technicianId: activation.body.id });

    const payment = await request(app).post(`/api/bookings/${booking.body.id}/payment`).set("Cookie", authCookie(customer)!).send({ phoneNumber: "+251911300008", returnUrl: "https://example.test/payment-return" });
    expect(payment.status).toBe(202);
    expect(payment.body.status).toBe("PENDING");

    const other = await request(app).post("/api/auth/register").send({ fullName: "Other User", phoneNumber: "+251911300010", password: "hunter2pass" });
    const forbidden = await request(app).post(`/api/payments/${payment.body.transactionId}/verify`).set("Cookie", authCookie(other)!).send();
    expect(forbidden.status).toBe(403);
    const verify = await request(app).post(`/api/payments/${payment.body.transactionId}/verify`).set("Cookie", authCookie(customer)!).send();
    expect(verify.status).toBe(200);
    expect(verify.body.status).toBe("PENDING");
  });
});
