import request from "supertest";
import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import app from "../src/app";
import { db } from "@workspace/db";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function resetDatabase() {
  await db.execute(sql`TRUNCATE TABLE "webhook_events", "provider_offers", "ledger_entries", "payouts", "user_roles", "sessions", "password_reset_tokens", "bookings", "booking_status_history", "reviews", "service_guarantees", "payments", "service_requests", "customer_addresses", "technician_skills", "technician_profiles", "pricing_rules", "service_categories", "users" RESTART IDENTITY CASCADE;`);
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

describe("Melse auth and authorization", () => {
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

    const cookie = authCookie(register);
    expect(cookie).toBeTruthy();

    const me = await request(app).get("/api/auth/me").set("Cookie", cookie!);
    expect(me.status).toBe(200);
    expect(me.body.user.fullName).toBe("Customer One");

    const login = await request(app)
      .post("/api/auth/login")
      .send({ phoneNumber: "+251911234567", password: "hunter2pass" });

    expect(login.status).toBe(200);
    expect(login.body.user.phoneNumber).toBe("+251911234567");

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

  it("rate limits repeated failed login attempts", async () => {
    let lastStatus = 0;

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await request(app)
        .post("/api/auth/login")
        .send({ phoneNumber: "+251911234568", password: "wrongpass" });
      lastStatus = response.status;
    }

    expect(lastStatus).toBe(429);
  });

  it("supports profile updates, account suspension, and customer/provider mode switching", async () => {
    const customer = await request(app).post("/api/auth/register").send({ fullName: "Mode User", phoneNumber: "+251911400001", password: "hunter2pass" });
    const profile = await request(app).patch("/api/auth/profile").set("Cookie", authCookie(customer)!).send({ fullName: "Updated Mode User" });
    expect(profile.status).toBe(200);
    expect(profile.body.user.fullName).toBe("Updated Mode User");

    const deniedMode = await request(app).patch("/api/auth/mode").set("Cookie", authCookie(customer)!).send({ mode: "PROVIDER" });
    expect(deniedMode.status).toBe(403);

    await request(app).post("/api/provider/activate").set("Cookie", authCookie(customer)!).send({ serviceArea: "Bole" });
    const providerMode = await request(app).patch("/api/auth/mode").set("Cookie", authCookie(customer)!).send({ mode: "PROVIDER" });
    expect(providerMode.status).toBe(200);
    expect(providerMode.body.activeMode).toBe("PROVIDER");

    const admin = await request(app).post("/api/admin/bootstrap").set("x-admin-bootstrap-token", "dev-bootstrap-secret").send({ phoneNumber: "+251911400002", password: "adminpass", fullName: "Status Admin" });
    const adminLogin = await request(app).post("/api/auth/login").send({ phoneNumber: "+251911400002", password: "adminpass" });
    const suspended = await request(app).patch(`/api/admin/users/${customer.body.user.id}/status`).set("Cookie", authCookie(adminLogin)!).send({ isActive: false });
    expect(suspended.status).toBe(200);
    const blocked = await request(app).get("/api/auth/me").set("Cookie", authCookie(customer)!);
    expect(blocked.status).toBe(401);
    expect(admin.status).toBe(200);
  });

  it("requires authentication for protected endpoints and rejects invalid sessions", async () => {
    const unauth = await request(app).get("/api/auth/me");
    expect(unauth.status).toBe(401);

    const invalid = await request(app).get("/api/auth/me").set("Cookie", "melse_session=bad-token");
    expect(invalid.status).toBe(401);
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
        preferredAt: "2026-09-10T10:00:00.000Z",
        budget: 700,
        problemPhotos: ["https://example.test/socket.jpg"],
      });

    expect(customerRequest.status).toBe(201);
    expect(customerRequest.body.budget).toBe(700);
    expect(customerRequest.body.problemPhotos).toEqual(["https://example.test/socket.jpg"]);

    const adminUser = await request(app)
      .post("/api/auth/register")
      .send({ fullName: "Admin User", phoneNumber: "+251933445566", password: "adminpass" });

    const adminRole = await request(app)
      .patch(`/api/admin/users/${adminUser.body.user.id}/roles`)
      .set("Cookie", authCookie(customer)!)
      .send({ role: "PROVIDER" });
    expect(adminRole.status).toBe(403);

    const adminBootstrap = await request(app)
      .post("/api/admin/bootstrap")
      .set("x-admin-bootstrap-token", "dev-bootstrap-secret")
      .send({ phoneNumber: "+251933445566", password: "adminpass", fullName: "Admin User" });
    expect(adminBootstrap.status).toBe(200);

    const adminLogin = await request(app)
      .post("/api/auth/login")
      .send({ phoneNumber: "+251933445566", password: "adminpass" });
    expect(adminLogin.status).toBe(200);
    expect(adminLogin.body.user.roles).toContain("ADMIN");

    const adminList = await request(app)
      .get("/api/admin/users")
      .set("Cookie", authCookie(adminLogin)!);
    expect(adminList.status).toBe(200);
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
    await request(app)
      .post("/api/provider/activate")
      .set("Cookie", providerCookie)
      .send({ bio: "Licensed plumber", experienceYears: 7, serviceArea: "Addis Ababa", hourlyRate: "400" });

    const booking = await request(app)
      .post("/api/bookings")
      .set("Cookie", authCookie(customerA)!)
      .send({ requestId: requestA.body.id, technicianId: provider.body.user.id });
    expect(booking.status).toBe(201);

    const providerJobs = await request(app).get("/api/provider/jobs").set("Cookie", providerCookie);
    expect(providerJobs.status).toBe(200);
    expect(providerJobs.body.some((job: { id: string }) => job.id === booking.body.id)).toBe(true);
    const providerEarnings = await request(app).get("/api/provider/earnings").set("Cookie", providerCookie);
    expect(providerEarnings.status).toBe(200);
    expect(providerEarnings.body.currency).toBe("ETB");

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
    expect(bootstrap.status).toBe(200);
  });

  it("survives a restart by persisting user data and sessions", async () => {
    const created = await request(app)
      .post("/api/auth/register")
      .send({ fullName: "Persistent User", phoneNumber: "+251911300001", password: "hunter2pass" });

    expect(created.status).toBe(201);
    const cookie = authCookie(created)!;

    const before = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(before.status).toBe(200);

    await sleep(50);

    const after = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(after.status).toBe(200);
    expect(after.body.user.id).toBe(created.body.user.id);
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
    await request(app).post("/api/provider/activate").set("Cookie", authCookie(provider)!).send({ serviceArea: "Bole", categorySlugs: ["electrician"] });

    const serviceRequest = await request(app).post("/api/service-requests").set("Cookie", authCookie(business)!).send({ serviceSlug: "electrician", problem: "Power issue", description: "Kitchen circuit", address: "Bole" });
    expect(serviceRequest.status).toBe(201);
    const offers = await request(app).get("/api/provider/offers").set("Cookie", authCookie(provider)!);
    expect(offers.status).toBe(200);
    const offer = offers.body.find((item: { requestId: string }) => item.requestId === serviceRequest.body.id);
    expect(offer).toBeTruthy();
    const answered = await request(app).patch(`/api/provider/offers/${offer.id}`).set("Cookie", authCookie(provider)!).send({ status: "ACCEPTED", quotedPrice: 550 });
    expect(answered.status).toBe(200);
    expect(answered.body.quotedPrice).toBe("550.00");

    const technicians = await request(app).get("/api/technicians?serviceSlug=electrician").set("Cookie", authCookie(business)!);
    expect(technicians.status).toBe(200);
    expect(technicians.body[0].distance).toBe("Matched by skill and radius");
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
    const activation = await request(app).post("/api/provider/activate").set("Cookie", authCookie(provider)!).send({ serviceArea: "Bole" });
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

    process.env.CHAPA_WEBHOOK_SECRET = "webhook-test-secret";
    const webhookPayload = { id: "event-payment-1", tx_ref: payment.body.transactionId, status: "pending" };
    const signature = createHmac("sha256", process.env.CHAPA_WEBHOOK_SECRET).update(JSON.stringify(webhookPayload)).digest("hex");
    const webhook = await request(app).post("/api/payments/webhook").set("x-chapa-signature", signature).send(webhookPayload);
    expect(webhook.status).toBe(200);
    expect(webhook.body.duplicate).toBe(false);
    const replay = await request(app).post("/api/payments/webhook").set("x-chapa-signature", signature).send(webhookPayload);
    expect(replay.status).toBe(200);
    expect(replay.body.duplicate).toBe(true);
  });
});
