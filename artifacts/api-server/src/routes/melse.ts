import { Router, type IRouter } from "express";
import { and, eq, inArray, or } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { createHmac, timingSafeEqual } from "node:crypto";
import { CreateBookingBody, CreateServiceRequestBody, ListTechniciansQueryParams, UpdateBookingStatusBody, GetBookingParams, UpdateBookingStatusParams } from "@workspace/api-zod";
import { auditLogsTable, bookingStatusHistoryTable, customerAssetsTable, db, bookingsTable, disputesTable, disputeEvidenceTable, homecarePlansTable, homecareSubscriptionsTable, ledgerEntriesTable, loyaltyAccountsTable, loyaltyTransactionsTable, maintenanceRecommendationsTable, paymentsTable, payoutsTable, pricingRulesTable, providerOffersTable, promotionsTable, reviewsTable, serviceCategoriesTable, serviceGuaranteesTable, serviceRequestsTable, technicianProfilesTable, usersTable, technicianSkillsTable, webhookEventsTable } from "@workspace/db";
import { currentUser, requireAuth, requireRole } from "../middlewares/auth";
import { canTransition } from "../lib/job-state";
import { calculateEstimate } from "../lib/pricing";
import { ChapaPaymentProvider, UnconfiguredPaymentProvider } from "../lib/payment";

const router: IRouter = Router();
const paymentProvider = process.env.CHAPA_SECRET_KEY ? new ChapaPaymentProvider() : new UnconfiguredPaymentProvider();
const services = [
  { id: "svc-1", slug: "appliance-repair", name: "Appliance repair", description: "Fridges, washing machines, cookers and more", icon: "appliance", startingPrice: 400, priceMax: 700, arrival: "25–35 min", accent: "ochre" },
  { id: "svc-2", slug: "electrician", name: "Electrician", description: "Safe, reliable help for electrical problems", icon: "electric", startingPrice: 350, priceMax: 650, arrival: "20–30 min", accent: "gold" },
  { id: "svc-3", slug: "plumber", name: "Plumber", description: "Leaks, drains, faucets and installations", icon: "plumber", startingPrice: 400, priceMax: 700, arrival: "25–35 min", accent: "blue" },
  { id: "svc-4", slug: "ac-refrigeration", name: "AC & refrigeration", description: "Keep your home cool and comfortable", icon: "ac", startingPrice: 500, priceMax: 900, arrival: "30–45 min", accent: "mint" },
  { id: "svc-5", slug: "cleaning", name: "Cleaning", description: "A fresh, cared-for home without the hassle", icon: "cleaning", startingPrice: 500, priceMax: 1000, arrival: "Same day", accent: "coral" },
] as const;

function serviceFor(slug: string) { return services.find((service) => service.slug === slug) ?? services[0]; }

async function requestResponse(request: typeof serviceRequestsTable.$inferSelect) {
  const [category] = await db.select({ slug: serviceCategoriesTable.slug }).from(serviceCategoriesTable).where(eq(serviceCategoriesTable.id, request.categoryId)).limit(1);
  const service = serviceFor(category?.slug ?? "");
  const [problem, description = ""] = request.problemDescription.split("\n");
  return { serviceSlug: service.slug, problem, description, address: request.address, id: request.id, createdAt: request.createdAt.toISOString(), priceMin: Number(request.estimatedPriceMin), priceMax: Number(request.estimatedPriceMax), arrival: service.arrival };
}

async function bookingResponse(booking: typeof bookingsTable.$inferSelect) {
  const [request] = await db.select().from(serviceRequestsTable).where(eq(serviceRequestsTable.id, booking.requestId)).limit(1);
  const [provider] = await db.select({ name: usersTable.fullName }).from(technicianProfilesTable).innerJoin(usersTable, eq(technicianProfilesTable.userId, usersTable.id)).where(eq(technicianProfilesTable.id, booking.technicianId)).limit(1);
  const requestView = request ? await requestResponse(request) : undefined;
  return { id: booking.id, requestId: booking.requestId, technicianId: booking.technicianId, technicianName: provider?.name ?? "Provider", serviceName: requestView?.serviceSlug ?? "Service", address: request?.address ?? "", status: booking.status, priceMin: requestView?.priceMin ?? 0, priceMax: requestView?.priceMax ?? 0, eta: "Provider will confirm", createdAt: booking.createdAt.toISOString(), progress: booking.status === "COMPLETED" ? 100 : booking.status === "IN_PROGRESS" ? 75 : booking.status === "ARRIVED" ? 55 : 25 };
}

router.get("/services", (_req, res) => res.json(services));

router.get("/technicians", requireAuth, async (req, res, next) => {
  const parsed = ListTechniciansQueryParams.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Invalid technician filters." });
  try {
    const serviceSlug = parsed.data.serviceSlug;
    const requestId = parsed.data.requestId;
    let requestedCategoryId: string | undefined;
    if (serviceSlug) {
      const [category] = await db.select({ id: serviceCategoriesTable.id }).from(serviceCategoriesTable).where(eq(serviceCategoriesTable.slug, serviceSlug)).limit(1);
      requestedCategoryId = category?.id;
      if (!requestedCategoryId) return res.json([]);
    }
    if (requestId) {
      const [request] = await db.select({ categoryId: serviceRequestsTable.categoryId }).from(serviceRequestsTable).where(eq(serviceRequestsTable.id, requestId)).limit(1);
      requestedCategoryId = request?.categoryId ?? requestedCategoryId;
    }
    const rows = await db.select({ profile: technicianProfilesTable, name: usersTable.fullName }).from(technicianProfilesTable).innerJoin(usersTable, eq(technicianProfilesTable.userId, usersTable.id)).where(and(eq(technicianProfilesTable.verificationStatus, "VERIFIED"), eq(technicianProfilesTable.isAvailable, true)));
    const skillRows = requestedCategoryId ? await db.select().from(technicianSkillsTable).where(eq(technicianSkillsTable.categoryId, requestedCategoryId)) : [];
    const skilledIds = new Set(skillRows.map((row) => row.technicianId));
    const eligible = requestedCategoryId ? rows.filter(({ profile }) => skilledIds.has(profile.id)) : rows;
    const requestCoordinates = requestId ? await db.select({ latitude: serviceRequestsTable.latitude, longitude: serviceRequestsTable.longitude }).from(serviceRequestsTable).where(eq(serviceRequestsTable.id, requestId)).limit(1) : [];
    const distance = (latitude: number, longitude: number) => {
      const target = requestCoordinates[0];
      if (!target || profileCoordinatesMissing(latitude, longitude)) return undefined;
      const radians = Math.PI / 180;
      const dLat = (latitude - Number(target.latitude)) * radians;
      const dLon = (longitude - Number(target.longitude)) * radians;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(Number(target.latitude) * radians) * Math.cos(latitude * radians) * Math.sin(dLon / 2) ** 2;
      return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };
    const nearby = eligible.filter(({ profile }) => { if (profile.currentLatitude === null || profile.currentLongitude === null) return true; const km = distance(Number(profile.currentLatitude), Number(profile.currentLongitude)); return km === undefined || km <= profile.serviceRadiusKm; });
    const ranked = [...eligible].sort((left, right) => (Number(right.profile.ratingAvg) * Number(right.profile.completionRate) * Number(right.profile.responseRate) - Number(left.profile.ratingAvg) * Number(left.profile.completionRate) * Number(left.profile.responseRate)) || right.profile.ratingCount - left.profile.ratingCount);
    return res.json(ranked.filter(({ profile }) => nearby.some(({ profile: nearbyProfile }) => nearbyProfile.id === profile.id)).map(({ profile, name }) => ({ id: profile.id, name, initials: name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase(), rating: Number(profile.ratingAvg), reviews: profile.ratingCount, verified: true, distance: requestedCategoryId ? "Matched by skill and radius" : "Available in your area", eta: "To confirm", earnings: profile.hourlyRate ? `ETB ${profile.hourlyRate}/hr` : "Quote after review", specialty: profile.serviceArea ?? "Local services", available: profile.isAvailable })));
  } catch (error) { return next(error); }
});

function profileCoordinatesMissing(latitude: number, longitude: number) { return !Number.isFinite(latitude) || !Number.isFinite(longitude); }

router.get("/service-requests", requireAuth, async (req, res, next) => {
  try {
    const user = currentUser(req)!;
    const rows = user.roles.includes("ADMIN") ? await db.select().from(serviceRequestsTable) : await db.select().from(serviceRequestsTable).where(eq(serviceRequestsTable.customerId, user.id));
    return res.json(await Promise.all(rows.map(requestResponse)));
  } catch (error) { return next(error); }
});

router.get("/provider/jobs", requireRole("PROVIDER"), async (req, res, next) => {
  try {
    const [profile] = await db.select({ id: technicianProfilesTable.id }).from(technicianProfilesTable).where(eq(technicianProfilesTable.userId, currentUser(req)!.id)).limit(1);
    if (!profile) return res.json([]);
    const rows = await db.select().from(bookingsTable).where(eq(bookingsTable.technicianId, profile.id));
    return res.json(await Promise.all(rows.map(bookingResponse)));
  } catch (error) { return next(error); }
});

router.get("/provider/earnings", requireRole("PROVIDER"), async (req, res, next) => {
  try {
    const [profile] = await db.select({ id: technicianProfilesTable.id }).from(technicianProfilesTable).where(eq(technicianProfilesTable.userId, currentUser(req)!.id)).limit(1);
    if (!profile) return res.json({ completedJobs: 0, total: 0, currency: "ETB" });
    const rows = await db.select({ finalPrice: bookingsTable.finalPrice }).from(bookingsTable).where(and(eq(bookingsTable.technicianId, profile.id), eq(bookingsTable.status, "COMPLETED")));
    return res.json({ completedJobs: rows.length, total: rows.reduce((sum, row) => sum + Number(row.finalPrice ?? 0), 0), currency: "ETB" });
  } catch (error) { return next(error); }
});

router.post("/service-requests", requireRole("CUSTOMER"), async (req, res, next) => {
  const parsed = CreateServiceRequestBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Please complete the request details." });
  try {
    const [category] = await db.select().from(serviceCategoriesTable).where(eq(serviceCategoriesTable.slug, parsed.data.serviceSlug)).limit(1);
    if (!category) return res.status(400).json({ error: "That service is not available." });
    const service = serviceFor(parsed.data.serviceSlug);
    const [pricing] = await db.select().from(pricingRulesTable).where(eq(pricingRulesTable.categoryId, category.id)).limit(1);
    const estimate = calculateEstimate({ baseMin: pricing ? Number(pricing.basePriceMin) : service.startingPrice, baseMax: pricing ? Number(pricing.basePriceMax) : service.priceMax, emergencyFee: pricing ? Number(pricing.emergencyFee) : 150, commissionRate: pricing ? Number(pricing.platformCommissionRate) : 0.15 }, { isEmergency: parsed.data.urgency === "Emergency", distanceKm: 0 });
    const [request] = await db.insert(serviceRequestsTable).values({ customerId: currentUser(req)!.id, categoryId: category.id, problemDescription: `${parsed.data.problem}\n${parsed.data.description}`, address: parsed.data.address, latitude: "9.005401", longitude: "38.763611", preferredAt: parsed.data.preferredAt ? new Date(parsed.data.preferredAt) : undefined, budget: parsed.data.budget !== undefined ? String(parsed.data.budget) : undefined, problemPhotos: parsed.data.problemPhotos, estimatedPriceMin: String(estimate.minPrice), estimatedPriceMax: String(estimate.maxPrice) }).returning();
    if (!request) return res.status(500).json({ error: "Could not create the request." });
    const skilled = await db.select({ technicianId: technicianSkillsTable.technicianId }).from(technicianSkillsTable).innerJoin(technicianProfilesTable, eq(technicianSkillsTable.technicianId, technicianProfilesTable.id)).where(and(eq(technicianSkillsTable.categoryId, category.id), eq(technicianProfilesTable.isAvailable, true), eq(technicianProfilesTable.verificationStatus, "VERIFIED")));
    if (skilled.length) await db.insert(providerOffersTable).values(skilled.map(({ technicianId }) => ({ requestId: request.id, technicianId }))).onConflictDoNothing();
    return res.status(201).json({ ...parsed.data, id: request.id, createdAt: request.createdAt.toISOString(), priceMin: estimate.minPrice, priceMax: estimate.maxPrice, arrival: service.arrival });
  } catch (error) { return next(error); }
});

router.post("/bookings", requireRole("CUSTOMER"), async (req, res, next) => {
  const parsed = CreateBookingBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose a technician to continue." });
  try {
    const user = currentUser(req)!;
    const [request] = await db.select().from(serviceRequestsTable).where(and(eq(serviceRequestsTable.id, parsed.data.requestId), eq(serviceRequestsTable.customerId, user.id))).limit(1);
    const [technician] = await db.select().from(technicianProfilesTable).where(or(eq(technicianProfilesTable.id, parsed.data.technicianId), eq(technicianProfilesTable.userId, parsed.data.technicianId))).limit(1);
    if (!request || !technician || !technician.isAvailable || technician.verificationStatus !== "VERIFIED") return res.status(404).json({ error: "We couldn't find that request or provider." });
    await db.insert(providerOffersTable).values({ requestId: request.id, technicianId: technician.id, status: "ACCEPTED" }).onConflictDoNothing();
    const [booking] = await db.transaction(async (tx) => {
      const inserted = await tx.insert(bookingsTable).values({ requestId: request.id, customerId: user.id, technicianId: technician.id }).returning();
      await tx.update(serviceRequestsTable).set({ technicianId: technician.id, status: "ASSIGNED", updatedAt: new Date() }).where(eq(serviceRequestsTable.id, request.id));
      if (inserted[0]) await tx.insert(bookingStatusHistoryTable).values({ bookingId: inserted[0].id, status: "ASSIGNED", changedBy: user.id });
      return inserted;
    });
    return booking ? res.status(201).json(await bookingResponse(booking)) : res.status(500).json({ error: "Could not create the booking." });
  } catch (error) { return next(error); }
});

router.get("/provider/offers", requireRole("PROVIDER"), async (req, res, next) => {
  try {
    const [profile] = await db.select({ id: technicianProfilesTable.id }).from(technicianProfilesTable).where(eq(technicianProfilesTable.userId, currentUser(req)!.id)).limit(1);
    if (!profile) return res.json([]);
    return res.json(await db.select().from(providerOffersTable).where(eq(providerOffersTable.technicianId, profile.id)));
  } catch (error) { return next(error); }
});

router.patch("/provider/offers/:id", requireRole("PROVIDER"), async (req, res, next) => {
  const id = z.string().uuid().safeParse(req.params.id);
  const parsed = z.object({ status: z.enum(["ACCEPTED", "DECLINED"]), quotedPrice: z.number().positive().optional() }).safeParse(req.body);
  if (!id.success || !parsed.success) return res.status(400).json({ error: "Invalid offer response." });
  try {
    const [profile] = await db.select({ id: technicianProfilesTable.id }).from(technicianProfilesTable).where(eq(technicianProfilesTable.userId, currentUser(req)!.id)).limit(1);
    if (!profile) return res.status(404).json({ error: "Provider profile not found." });
    const [offer] = await db.update(providerOffersTable).set({ status: parsed.data.status, quotedPrice: parsed.data.quotedPrice ? String(parsed.data.quotedPrice) : undefined, respondedAt: new Date() }).where(and(eq(providerOffersTable.id, id.data), eq(providerOffersTable.technicianId, profile.id), eq(providerOffersTable.status, "PENDING"))).returning();
    return offer ? res.json(offer) : res.status(404).json({ error: "Offer not found or already answered." });
  } catch (error) { return next(error); }
});
router.get("/bookings/:id", requireAuth, async (req, res, next) => {
  const parsed = GetBookingParams.safeParse(req.params);
  if (!parsed.success) return res.status(404).json({ error: "Booking not found." });
  try {
    const user = currentUser(req)!;
    const condition = user.roles.includes("ADMIN") ? eq(bookingsTable.id, parsed.data.id) : and(eq(bookingsTable.id, parsed.data.id), eq(bookingsTable.customerId, user.id));
    const [booking] = await db.select().from(bookingsTable).where(condition).limit(1);
    return booking ? res.json(await bookingResponse(booking)) : res.status(404).json({ error: "Booking not found." });
  } catch (error) { return next(error); }
});

router.patch("/bookings/:id/status", requireAuth, async (req, res, next) => {
  const params = UpdateBookingStatusParams.safeParse(req.params);
  const body = UpdateBookingStatusBody.safeParse(req.body);
  if (!params.success || !body.success) return res.status(400).json({ error: "Invalid booking status." });
  try {
    const user = currentUser(req)!;
    const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, params.data.id)).limit(1);
    if (!booking) return res.status(404).json({ error: "Booking not found." });
    const [provider] = await db.select({ userId: technicianProfilesTable.userId }).from(technicianProfilesTable).where(eq(technicianProfilesTable.id, booking.technicianId)).limit(1);
    const customerStatuses = ["CUSTOMER_CONFIRMED", "DISPUTED", "CANCELLED"];
    const providerStatuses = ["ACCEPTED", "TECHNICIAN_EN_ROUTE", "ARRIVED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "DISPUTED"];
    const authorized = user.roles.includes("ADMIN") || (booking.customerId === user.id && customerStatuses.includes(body.data.status)) || (provider?.userId === user.id && providerStatuses.includes(body.data.status));
    if (!authorized) return res.status(403).json({ error: "You cannot make that job update." });
    if (!canTransition(booking.status, body.data.status)) return res.status(409).json({ error: `A job cannot move from ${booking.status} to ${body.data.status}.` });
    const [updated] = await db.update(bookingsTable).set({ status: body.data.status, updatedAt: new Date() }).where(eq(bookingsTable.id, booking.id)).returning();
    await db.update(serviceRequestsTable).set({ status: body.data.status, updatedAt: new Date() }).where(eq(serviceRequestsTable.id, booking.requestId));
    await db.insert(bookingStatusHistoryTable).values({ bookingId: booking.id, status: body.data.status, changedBy: user.id });
    if (body.data.status === "COMPLETED") {
      await db.insert(serviceGuaranteesTable).values({ bookingId: booking.id, guaranteeDays: 7, validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), status: "ACTIVE" }).onConflictDoNothing();
      await db.transaction(async (tx) => {
        await tx.insert(loyaltyAccountsTable).values({ customerId: booking.customerId, points: 0 }).onConflictDoNothing();
        const [account] = await tx.select().from(loyaltyAccountsTable).where(eq(loyaltyAccountsTable.customerId, booking.customerId)).limit(1);
        if (!account) return;
        const [reward] = await tx.select().from(loyaltyTransactionsTable).where(and(eq(loyaltyTransactionsTable.accountId, account.id), eq(loyaltyTransactionsTable.reason, `Completed service ${booking.id}`))).limit(1);
        if (!reward) {
          await tx.insert(loyaltyTransactionsTable).values({ accountId: account.id, points: 100, reason: `Completed service ${booking.id}` });
          await tx.update(loyaltyAccountsTable).set({ points: account.points + 100, updatedAt: new Date() }).where(eq(loyaltyAccountsTable.id, account.id));
        }
      });
    }
    return updated ? res.json(await bookingResponse(updated)) : res.status(500).json({ error: "Could not update the booking." });
  } catch (error) { return next(error); }
});

router.get("/dashboard/summary", requireAuth, async (req, res, next) => {
  try {
    const user = currentUser(req)!;
    const requests = await db.select().from(serviceRequestsTable).where(eq(serviceRequestsTable.customerId, user.id));
    const [active] = await db.select().from(bookingsTable).where(and(eq(bookingsTable.customerId, user.id), inArray(bookingsTable.status, ["ASSIGNED", "ACCEPTED", "TECHNICIAN_EN_ROUTE", "ARRIVED", "IN_PROGRESS"]))).limit(1);
    return res.json({ activeBooking: active ? await bookingResponse(active) : null, recentRequests: await Promise.all(requests.slice(0, 3).map(requestResponse)), savedAddress: "Addis Ababa", trustStats: { verifiedProfessionals: "Database-backed", averageRating: "Provider profile rating", guarantee: "7-day guarantee" } });
  } catch (error) { return next(error); }
});

router.get("/service-history", requireRole("CUSTOMER"), async (req, res, next) => {
  try {
    const rows = await db.select().from(serviceRequestsTable).where(eq(serviceRequestsTable.customerId, currentUser(req)!.id));
    return res.json(await Promise.all(rows.map(requestResponse)));
  } catch (error) { return next(error); }
});

router.post("/bookings/:id/review", requireRole("CUSTOMER"), async (req, res, next) => {
  const id = z.string().uuid().safeParse(req.params.id);
  const body = z.object({ rating: z.number().int().min(1).max(5), comment: z.string().max(2000).optional() }).safeParse(req.body);
  if (!id.success || !body.success) return res.status(400).json({ error: "Provide a rating from 1 to 5." });
  try {
    const [booking] = await db.select().from(bookingsTable).where(and(eq(bookingsTable.id, id.data), eq(bookingsTable.customerId, currentUser(req)!.id))).limit(1);
    if (!booking || !["COMPLETED", "CUSTOMER_CONFIRMED", "PAID", "RATED"].includes(booking.status)) return res.status(409).json({ error: "Only completed bookings can be reviewed." });
    const [existing] = await db.select().from(reviewsTable).where(eq(reviewsTable.bookingId, booking.id)).limit(1);
    if (existing) return res.status(409).json({ error: "This booking has already been reviewed." });
    const [review] = await db.insert(reviewsTable).values({ bookingId: booking.id, customerId: booking.customerId, technicianId: booking.technicianId, rating: body.data.rating, comment: body.data.comment }).returning();
    if (review) await db.insert(auditLogsTable).values({ actorId: currentUser(req)!.id, action: "REVIEW_CREATED", entityType: "booking", entityId: booking.id });
    return review ? res.status(201).json(review) : res.status(500).json({ error: "Could not save review." });
  } catch (error) { return next(error); }
});

router.post("/bookings/:id/disputes", requireAuth, async (req, res, next) => {
  const id = z.string().uuid().safeParse(req.params.id);
  const body = z.object({ reason: z.string().trim().min(10).max(4000), evidenceUrl: z.string().url().optional(), note: z.string().max(2000).optional() }).safeParse(req.body);
  if (!id.success || !body.success) return res.status(400).json({ error: "Provide a clear dispute reason." });
  try {
    const user = currentUser(req)!;
    const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id.data)).limit(1);
    const [provider] = booking ? await db.select({ userId: technicianProfilesTable.userId }).from(technicianProfilesTable).where(eq(technicianProfilesTable.id, booking.technicianId)).limit(1) : [];
    if (!booking || (booking.customerId !== user.id && provider?.userId !== user.id && !user.roles.includes("ADMIN"))) return res.status(404).json({ error: "Booking not found." });
    const [dispute] = await db.insert(disputesTable).values({ bookingId: booking.id, openedBy: user.id, reason: body.data.reason }).returning();
    if (!dispute) return res.status(500).json({ error: "Could not open dispute." });
    if (body.data.evidenceUrl) await db.insert(disputeEvidenceTable).values({ disputeId: dispute.id, submittedBy: user.id, evidenceUrl: body.data.evidenceUrl, note: body.data.note });
    await db.insert(auditLogsTable).values({ actorId: user.id, action: "DISPUTE_OPENED", entityType: "booking", entityId: booking.id });
    return res.status(201).json(dispute);
  } catch (error) { return next(error); }
});

router.get("/admin/disputes", requireRole("ADMIN"), async (_req, res, next) => {
  try { return res.json(await db.select().from(disputesTable).where(eq(disputesTable.status, "OPEN"))); } catch (error) { return next(error); }
});

router.patch("/admin/disputes/:id", requireRole("ADMIN"), async (req, res, next) => {
  const id = z.string().uuid().safeParse(req.params.id);
  const body = z.object({ status: z.enum(["RESOLVED", "REJECTED"]), resolution: z.string().trim().min(2).max(4000) }).safeParse(req.body);
  if (!id.success || !body.success) return res.status(400).json({ error: "Provide a valid dispute resolution." });
  try {
    const [dispute] = await db.update(disputesTable).set({ status: body.data.status, resolution: body.data.resolution, resolvedAt: new Date() }).where(and(eq(disputesTable.id, id.data), eq(disputesTable.status, "OPEN"))).returning();
    if (dispute) await db.insert(auditLogsTable).values({ actorId: currentUser(req)!.id, action: "DISPUTE_RESOLVED", entityType: "dispute", entityId: dispute.id, metadata: body.data.resolution });
    return dispute ? res.json(dispute) : res.status(404).json({ error: "Open dispute not found." });
  } catch (error) { return next(error); }
});

router.get("/bookings/:id/invoice", requireAuth, async (req, res, next) => {
  const parsed = GetBookingParams.safeParse(req.params);
  if (!parsed.success) return res.status(404).json({ error: "Invoice not found." });
  try {
    const user = currentUser(req)!;
    const condition = user.roles.includes("ADMIN") ? eq(bookingsTable.id, parsed.data.id) : and(eq(bookingsTable.id, parsed.data.id), eq(bookingsTable.customerId, user.id));
    const [booking] = await db.select().from(bookingsTable).where(condition).limit(1);
    if (!booking) return res.status(404).json({ error: "Invoice not found." });
    const [request] = await db.select().from(serviceRequestsTable).where(eq(serviceRequestsTable.id, booking.requestId)).limit(1);
    if (!request) return res.status(404).json({ error: "Invoice not found." });
    const view = await requestResponse(request);
    const total = Number(booking.finalPrice ?? request.estimatedPriceMax);
    return res.json({ id: booking.id, bookingId: booking.id, serviceRequestId: request.id, status: booking.status, service: view.serviceSlug, address: request.address, subtotal: total, total, currency: "ETB", issuedAt: booking.updatedAt.toISOString() });
  } catch (error) { return next(error); }
});

router.post("/bookings/:id/payment", requireRole("CUSTOMER"), async (req, res, next) => {
  const parsed = GetBookingParams.safeParse(req.params);
  const body = z.object({ phoneNumber: z.string().min(9), returnUrl: z.string().url() }).safeParse(req.body);
  if (!parsed.success || !body.success) return res.status(400).json({ error: "Provide valid payment details." });
  try {
    const user = currentUser(req)!;
    const [booking] = await db.select().from(bookingsTable).where(and(eq(bookingsTable.id, parsed.data.id), eq(bookingsTable.customerId, user.id))).limit(1);
    if (!booking) return res.status(404).json({ error: "Booking not found." });
    const [request] = await db.select().from(serviceRequestsTable).where(eq(serviceRequestsTable.id, booking.requestId)).limit(1);
    if (!request) return res.status(404).json({ error: "Service request not found." });
    const amount = Number(booking.finalPrice ?? request.estimatedPriceMax);
    const payment = await paymentProvider.initiatePayment({ bookingId: booking.id, amount, currency: "ETB", phoneNumber: body.data.phoneNumber, returnUrl: body.data.returnUrl });
    const paymentStatus = payment.status === "FAILED" ? "FAILED" : payment.status === "SUCCESS" ? "COMPLETED" : "PENDING";
    const [record] = await db.insert(paymentsTable).values({ bookingId: booking.id, amount: String(amount), provider: paymentProvider.name, providerReference: payment.transactionId, status: paymentStatus }).onConflictDoUpdate({ target: paymentsTable.bookingId, set: { amount: String(amount), providerReference: payment.transactionId, status: paymentStatus } }).returning();
    return record ? res.status(202).json({ paymentId: record.id, transactionId: payment.transactionId, status: record.status, redirectUrl: payment.redirectUrl }) : res.status(500).json({ error: "Could not start payment." });
  } catch (error) { return next(error); }
});

router.post("/payments/:transactionId/verify", requireRole("CUSTOMER"), async (req, res, next) => {
  const transactionId = z.string().min(1).safeParse(req.params.transactionId);
  if (!transactionId.success) return res.status(400).json({ error: "Invalid transaction." });
  try {
    const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.providerReference, transactionId.data)).limit(1);
    if (!payment) return res.status(404).json({ error: "Payment not found." });
    const [booking] = await db.select({ customerId: bookingsTable.customerId }).from(bookingsTable).where(eq(bookingsTable.id, payment.bookingId)).limit(1);
    if (!booking || booking.customerId !== currentUser(req)!.id) return res.status(403).json({ error: "You do not have permission for this payment." });
    const verified = await paymentProvider.verifyPayment(transactionId.data);
    if (verified) {
      await db.update(paymentsTable).set({ status: "COMPLETED" }).where(eq(paymentsTable.id, payment.id));
      const [bookingRequest] = await db.select({ requestId: bookingsTable.requestId }).from(bookingsTable).where(eq(bookingsTable.id, payment.bookingId)).limit(1);
      const [request] = bookingRequest ? await db.select({ categoryId: serviceRequestsTable.categoryId }).from(serviceRequestsTable).where(eq(serviceRequestsTable.id, bookingRequest.requestId)).limit(1) : [];
      const [pricing] = request ? await db.select({ commission: pricingRulesTable.platformCommissionRate }).from(pricingRulesTable).where(eq(pricingRulesTable.categoryId, request.categoryId)).limit(1) : [];
      const commissionRate = pricing ? Number(pricing.commission) : Number(process.env.DEFAULT_COMMISSION_RATE ?? "0");
      const commission = Number(payment.amount) * commissionRate;
      const [existingLedger] = await db.select({ id: ledgerEntriesTable.id }).from(ledgerEntriesTable).where(and(eq(ledgerEntriesTable.paymentId, payment.id), eq(ledgerEntriesTable.entryType, "CUSTOMER_PAYMENT"))).limit(1);
      if (!existingLedger) await db.insert(ledgerEntriesTable).values([{ bookingId: payment.bookingId, paymentId: payment.id, entryType: "CUSTOMER_PAYMENT", amount: payment.amount }, { bookingId: payment.bookingId, paymentId: payment.id, entryType: "PLATFORM_COMMISSION", amount: String(commission) }, { bookingId: payment.bookingId, paymentId: payment.id, entryType: "PROVIDER_EARNINGS", amount: String(Number(payment.amount) - commission) }]);
    }
    return res.json({ transactionId: transactionId.data, status: verified ? "SUCCESS" : "PENDING", verified });
  } catch (error) { return next(error); }
});

router.post("/payments/webhook", async (req, res, next) => {
  const signature = req.header("x-chapa-signature");
  const secret = process.env.CHAPA_WEBHOOK_SECRET;
  if (!secret || !signature) return res.status(401).json({ error: "Webhook verification is not configured." });
  const rawPayload = JSON.stringify(req.body);
  const expected = createHmac("sha256", secret).update(rawPayload).digest("hex");
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return res.status(401).json({ error: "Invalid webhook signature." });
  const eventId = typeof req.body?.id === "string" ? req.body.id : typeof req.body?.tx_ref === "string" ? req.body.tx_ref : undefined;
  if (!eventId) return res.status(400).json({ error: "Webhook event id is required." });
  try {
    const [event] = await db.insert(webhookEventsTable).values({ eventId, provider: "chapa", payload: rawPayload }).onConflictDoNothing().returning();
    if (!event) return res.json({ received: true, duplicate: true });
    return res.json({ received: true, duplicate: false });
  } catch (error) { return next(error); }
});

router.post("/admin/payments/:id/refund", requireRole("ADMIN"), async (req, res, next) => {
  const id = z.string().uuid().safeParse(req.params.id);
  const body = z.object({ amount: z.number().positive().optional() }).safeParse(req.body);
  if (!id.success || !body.success) return res.status(400).json({ error: "Invalid refund request." });
  try {
    const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, id.data)).limit(1);
    if (!payment || payment.status !== "COMPLETED") return res.status(409).json({ error: "Only completed payments can be refunded." });
    const amount = body.data.amount ?? Number(payment.amount);
    if (amount > Number(payment.amount)) return res.status(400).json({ error: "Refund cannot exceed the payment amount." });
    const refunded = await paymentProvider.processRefund(payment.bookingId, amount);
    if (!refunded) return res.status(409).json({ error: "The payment provider is not configured for refunds." });
    await db.update(paymentsTable).set({ status: "REFUNDED" }).where(eq(paymentsTable.id, payment.id));
    await db.insert(ledgerEntriesTable).values({ bookingId: payment.bookingId, paymentId: payment.id, entryType: "REFUND", amount: String(-amount) });
    return res.json({ paymentId: payment.id, amount, status: "REFUNDED" });
  } catch (error) { return next(error); }
});

router.get("/provider/payouts", requireRole("PROVIDER"), async (req, res, next) => {
  try {
    const [profile] = await db.select({ id: technicianProfilesTable.id }).from(technicianProfilesTable).where(eq(technicianProfilesTable.userId, currentUser(req)!.id)).limit(1);
    return res.json(profile ? await db.select().from(payoutsTable).where(eq(payoutsTable.technicianId, profile.id)) : []);
  } catch (error) { return next(error); }
});

router.post("/provider/payouts/request", requireRole("PROVIDER"), async (req, res, next) => {
  try {
    const [profile] = await db.select({ id: technicianProfilesTable.id }).from(technicianProfilesTable).where(eq(technicianProfilesTable.userId, currentUser(req)!.id)).limit(1);
    if (!profile) return res.status(404).json({ error: "Provider profile not found." });
    const [earned] = await db.select({ total: sql<number>`coalesce(sum(${ledgerEntriesTable.amount}), 0)` }).from(ledgerEntriesTable).innerJoin(bookingsTable, eq(ledgerEntriesTable.bookingId, bookingsTable.id)).where(and(eq(ledgerEntriesTable.entryType, "PROVIDER_EARNINGS"), eq(bookingsTable.technicianId, profile.id), eq(bookingsTable.status, "COMPLETED")));
    const [payout] = await db.insert(payoutsTable).values({ technicianId: profile.id, amount: String(Number(earned.total)) }).returning();
    return payout ? res.status(201).json(payout) : res.status(500).json({ error: "Could not create payout." });
  } catch (error) { return next(error); }
});

router.get("/bookings/:id/guarantee", requireAuth, async (req, res, next) => {
  const parsed = GetBookingParams.safeParse(req.params);
  if (!parsed.success) return res.status(404).json({ error: "Guarantee not found." });
  try {
    const user = currentUser(req)!;
    const condition = user.roles.includes("ADMIN") ? eq(bookingsTable.id, parsed.data.id) : and(eq(bookingsTable.id, parsed.data.id), eq(bookingsTable.customerId, user.id));
    const [booking] = await db.select().from(bookingsTable).where(condition).limit(1);
    if (!booking) return res.status(404).json({ error: "Guarantee not found." });
    const [guarantee] = await db.select().from(serviceGuaranteesTable).where(eq(serviceGuaranteesTable.bookingId, booking.id)).limit(1);
    return guarantee ? res.json({ id: guarantee.id, bookingId: guarantee.bookingId, guaranteeDays: guarantee.guaranteeDays, validUntil: guarantee.validUntil.toISOString(), status: guarantee.status }) : res.status(404).json({ error: "Guarantee not found." });
  } catch (error) { return next(error); }
});

router.get("/notifications", requireAuth, async (req, res, next) => {
  try {
    const bookings = await db.select().from(bookingsTable).where(eq(bookingsTable.customerId, currentUser(req)!.id));
    return res.json(bookings.map((booking) => ({ id: `booking-${booking.id}`, type: "BOOKING_UPDATE", bookingId: booking.id, title: `Booking ${booking.status.toLowerCase().replaceAll("_", " ")}`, read: false, createdAt: booking.updatedAt.toISOString() })));
  } catch (error) { return next(error); }
});

router.get("/homecare/plans", requireAuth, async (_req, res, next) => {
  try { return res.json(await db.select().from(homecarePlansTable).where(eq(homecarePlansTable.isActive, true))); } catch (error) { return next(error); }
});

router.post("/homecare/subscribe", requireRole("CUSTOMER"), async (req, res, next) => {
  const parsed = z.object({ planId: z.string().uuid() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose a valid HomeCare plan." });
  try {
    const [plan] = await db.select().from(homecarePlansTable).where(and(eq(homecarePlansTable.id, parsed.data.planId), eq(homecarePlansTable.isActive, true))).limit(1);
    if (!plan) return res.status(404).json({ error: "HomeCare plan not found." });
    const [subscription] = await db.insert(homecareSubscriptionsTable).values({ customerId: currentUser(req)!.id, planId: plan.id, nextBillingAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) }).returning();
    return subscription ? res.status(201).json({ ...subscription, plan }) : res.status(500).json({ error: "Could not start HomeCare." });
  } catch (error) { return next(error); }
});

router.get("/homecare/subscription", requireRole("CUSTOMER"), async (req, res, next) => {
  try {
    const [subscription] = await db.select({ subscription: homecareSubscriptionsTable, plan: homecarePlansTable }).from(homecareSubscriptionsTable).innerJoin(homecarePlansTable, eq(homecareSubscriptionsTable.planId, homecarePlansTable.id)).where(and(eq(homecareSubscriptionsTable.customerId, currentUser(req)!.id), eq(homecareSubscriptionsTable.status, "ACTIVE"))).limit(1);
    return subscription ? res.json(subscription) : res.status(404).json({ error: "No active HomeCare subscription." });
  } catch (error) { return next(error); }
});

router.get("/loyalty", requireRole("CUSTOMER"), async (req, res, next) => {
  try {
    const [account] = await db.select().from(loyaltyAccountsTable).where(eq(loyaltyAccountsTable.customerId, currentUser(req)!.id)).limit(1);
    if (!account) return res.json({ points: 0, transactions: [] });
    const transactions = await db.select().from(loyaltyTransactionsTable).where(eq(loyaltyTransactionsTable.accountId, account.id));
    return res.json({ points: account.points, transactions });
  } catch (error) { return next(error); }
});

router.post("/promotions/validate", requireAuth, async (req, res, next) => {
  const parsed = z.object({ code: z.string().trim().min(1).max(40) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter a promotion code." });
  try {
    const [promotion] = await db.select().from(promotionsTable).where(eq(promotionsTable.code, parsed.data.code.toUpperCase())).limit(1);
    if (!promotion || !promotion.isActive || promotion.expiresAt <= new Date() || (promotion.maxUses !== null && promotion.uses >= promotion.maxUses)) return res.status(404).json({ error: "Promotion code is invalid or expired." });
    return res.json({ code: promotion.code, description: promotion.description, discountPercent: promotion.discountPercent, expiresAt: promotion.expiresAt.toISOString() });
  } catch (error) { return next(error); }
});

router.get("/assets", requireRole("CUSTOMER"), async (req, res, next) => {
  try {
    const assets = await db.select({ asset: customerAssetsTable, category: serviceCategoriesTable.slug }).from(customerAssetsTable).innerJoin(serviceCategoriesTable, eq(customerAssetsTable.categoryId, serviceCategoriesTable.id)).where(eq(customerAssetsTable.customerId, currentUser(req)!.id));
    return res.json(assets.map(({ asset, category }) => ({ ...asset, category })));
  } catch (error) { return next(error); }
});

router.post("/assets", requireRole("CUSTOMER"), async (req, res, next) => {
  const parsed = z.object({ categorySlug: z.string().min(1), name: z.string().trim().min(2).max(120), manufacturer: z.string().max(100).optional(), model: z.string().max(100).optional(), lastServicedAt: z.string().datetime().optional(), notes: z.string().max(2000).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Provide valid asset details." });
  try {
    const [category] = await db.select({ id: serviceCategoriesTable.id }).from(serviceCategoriesTable).where(eq(serviceCategoriesTable.slug, parsed.data.categorySlug)).limit(1);
    if (!category) return res.status(404).json({ error: "Service category not found." });
    const [asset] = await db.insert(customerAssetsTable).values({ customerId: currentUser(req)!.id, categoryId: category.id, name: parsed.data.name, manufacturer: parsed.data.manufacturer, model: parsed.data.model, lastServicedAt: parsed.data.lastServicedAt ? new Date(parsed.data.lastServicedAt) : undefined, notes: parsed.data.notes }).returning();
    return asset ? res.status(201).json(asset) : res.status(500).json({ error: "Could not save asset." });
  } catch (error) { return next(error); }
});

router.get("/maintenance/recommendations", requireRole("CUSTOMER"), async (req, res, next) => {
  try {
    const assets = await db.select().from(customerAssetsTable).where(eq(customerAssetsTable.customerId, currentUser(req)!.id));
    const recommendations = await Promise.all(assets.map(async (asset) => {
      const [existing] = await db.select().from(maintenanceRecommendationsTable).where(and(eq(maintenanceRecommendationsTable.assetId, asset.id), eq(maintenanceRecommendationsTable.status, "OPEN"))).limit(1);
      if (existing) return existing;
      const dueAt = new Date((asset.lastServicedAt ?? asset.createdAt).getTime() + 180 * 24 * 60 * 60 * 1000);
      if (dueAt > new Date()) return undefined;
      const [created] = await db.insert(maintenanceRecommendationsTable).values({ assetId: asset.id, title: `Schedule ${asset.name} service`, reason: "This asset has not been serviced in the last six months.", dueAt }).returning();
      return created;
    }));
    return res.json(recommendations.filter(Boolean));
  } catch (error) { return next(error); }
});

router.get("/analytics/summary", requireRole("ADMIN"), async (_req, res, next) => {
  try {
    const [users] = await db.select({ count: sql<number>`count(*)` }).from(usersTable);
    const [requests] = await db.select({ count: sql<number>`count(*)` }).from(serviceRequestsTable);
    const [completed] = await db.select({ count: sql<number>`count(*)` }).from(bookingsTable).where(eq(bookingsTable.status, "COMPLETED"));
    const [active] = await db.select({ count: sql<number>`count(*)` }).from(bookingsTable).where(inArray(bookingsTable.status, ["ASSIGNED", "ACCEPTED", "TECHNICIAN_EN_ROUTE", "ARRIVED", "IN_PROGRESS"]));
    const [subscriptions] = await db.select({ count: sql<number>`count(*)` }).from(homecareSubscriptionsTable).where(eq(homecareSubscriptionsTable.status, "ACTIVE"));
    return res.json({ users: Number(users.count), serviceRequests: Number(requests.count), completedBookings: Number(completed.count), activeBookings: Number(active.count), activeHomecareSubscriptions: Number(subscriptions.count), generatedAt: new Date().toISOString() });
  } catch (error) { return next(error); }
});

router.get("/admin/pricing", requireRole("ADMIN"), async (_req, res, next) => {
  try {
    const rows = await db.select({ pricing: pricingRulesTable, category: serviceCategoriesTable.name, slug: serviceCategoriesTable.slug }).from(pricingRulesTable).innerJoin(serviceCategoriesTable, eq(pricingRulesTable.categoryId, serviceCategoriesTable.id));
    return res.json(rows.map(({ pricing, category, slug }) => ({ ...pricing, category, slug })));
  } catch (error) { return next(error); }
});

router.patch("/admin/pricing/:id", requireRole("ADMIN"), async (req, res, next) => {
  const id = z.string().uuid().safeParse(req.params.id);
  const parsed = z.object({ basePriceMin: z.number().nonnegative(), basePriceMax: z.number().nonnegative(), emergencyFee: z.number().nonnegative(), platformCommissionRate: z.number().min(0).max(1) }).refine((value) => value.basePriceMax >= value.basePriceMin).safeParse(req.body);
  if (!id.success || !parsed.success) return res.status(400).json({ error: "Invalid pricing rule." });
  try {
    const [pricing] = await db.update(pricingRulesTable).set({ basePriceMin: String(parsed.data.basePriceMin), basePriceMax: String(parsed.data.basePriceMax), emergencyFee: String(parsed.data.emergencyFee), platformCommissionRate: String(parsed.data.platformCommissionRate), updatedAt: new Date() }).where(eq(pricingRulesTable.id, id.data)).returning();
    return pricing ? res.json(pricing) : res.status(404).json({ error: "Pricing rule not found." });
  } catch (error) { return next(error); }
});

router.get("/admin/dispatch", requireRole("ADMIN"), async (_req, res, next) => {
  try {
    const rows = await db.select().from(bookingsTable).where(inArray(bookingsTable.status, ["REQUESTED", "SEARCHING", "ASSIGNED", "ACCEPTED", "TECHNICIAN_EN_ROUTE", "ARRIVED", "IN_PROGRESS", "COMPLETED"]));
    return res.json(await Promise.all(rows.map(bookingResponse)));
  } catch (error) { return next(error); }
});

router.post("/support/assist", requireAuth, async (req, res) => {
  const parsed = z.object({ message: z.string().trim().min(2).max(2000) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Tell us what you need help with." });
  const message = parsed.data.message.toLowerCase();
  const urgent = /spark|smoke|fire|gas|danger|flood|emergency/.test(message);
  const topic = /payment|invoice|price|cost/.test(message) ? "payment" : /booking|technician|arrival|job/.test(message) ? "booking" : /guarantee|warranty|repair again/.test(message) ? "guarantee" : "service";
  return res.json({ mode: "rules", needsHuman: urgent, topic, reply: urgent ? "If anyone is in danger, contact local emergency services first. A Melse support specialist can follow up on the service request." : topic === "payment" ? "Your estimate is a range. Open the booking invoice to review the recorded amount, or ask the service desk to help." : topic === "guarantee" ? "Completed bookings include a seven-day service guarantee when the guarantee record is active." : topic === "booking" ? "Open My Jobs to review the latest booking status and arrival details." : "Tell us the service, address area, and what is happening. The service desk can help choose the next step." });
});

export default router;
