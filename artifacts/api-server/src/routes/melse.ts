import { Router, type IRouter } from "express";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq, ilike, inArray, ne, or } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { CreateBookingBody, CreateServiceRequestBody, ListTechniciansQueryParams, UpdateBookingStatusBody, GetBookingParams, UpdateBookingStatusParams } from "@workspace/api-zod";
import { auditLogsTable, bookingStatusHistoryTable, customerAssetsTable, db, bookingsTable, conversationsTable, homecarePlansTable, homecareSubscriptionsTable, ledgerEntriesTable, loyaltyAccountsTable, loyaltyTransactionsTable, maintenanceRecommendationsTable, notificationsTable, paymentWebhookEventsTable, paymentsTable, pricingRulesTable, promotionsTable, providerOffersTable, serviceCategoriesTable, serviceGuaranteesTable, serviceRequestsTable, technicianProfilesTable, technicianServicePricingTable, technicianSkillsTable, usersTable } from "@workspace/db";
import { currentUser, requireAuth, requireRole } from "../middlewares/auth";
import { canTransition } from "../lib/job-state";
import { calculateEstimate, resolveProviderPrice } from "../lib/pricing";
import { ChapaPaymentProvider, PaymentProviderRequestError, PaymentProviderUnavailableError, type PaymentVerification } from "../lib/payment";
import { ProviderMatchingService } from "../lib/provider-matching";

const router: IRouter = Router();
const paymentProvider = new ChapaPaymentProvider();
const providerMatching = new ProviderMatchingService();
const servicePresentation: Record<string, { arrival: string; accent: string }> = {
  "appliance-repair": { arrival: "Provider will confirm", accent: "ochre" },
  electrician: { arrival: "Provider will confirm", accent: "gold" },
  plumber: { arrival: "Provider will confirm", accent: "blue" },
  "ac-refrigeration": { arrival: "Provider will confirm", accent: "mint" },
  cleaning: { arrival: "Provider will confirm", accent: "coral" },
};

function presentationFor(slug: string) { return servicePresentation[slug] ?? { arrival: "To be confirmed", accent: "mint" }; }

async function completeVerifiedPayment(transactionId: string, eventId: string, payloadHash: string, verification: PaymentVerification) {
  return db.transaction(async (tx) => {
    const [payment] = await tx.select().from(paymentsTable)
      .where(eq(paymentsTable.providerReference, transactionId))
      .limit(1)
      .for("update");
    if (!payment) return { kind: "not-found" as const };
    if (payment.status === "COMPLETED") return { kind: "already-completed" as const, payment };
    const paidCents = Math.round(Number(verification.amount) * 100);
    const expectedCents = Math.round(Number(payment.amount) * 100);
    if (verification.transactionId !== transactionId || verification.currency !== "ETB" || paidCents !== expectedCents) {
      await tx.update(paymentsTable).set({
        failureReason: "Verified amount, currency, or transaction reference does not match the payment record.",
      }).where(eq(paymentsTable.id, payment.id));
      return { kind: "verification-mismatch" as const };
    }
    const [booking] = await tx.select().from(bookingsTable)
      .where(eq(bookingsTable.id, payment.bookingId))
      .limit(1)
      .for("update");
    if (!booking) throw new Error("Verified payment references a missing booking.");
    if (booking.status !== "CUSTOMER_CONFIRMED") return { kind: "booking-not-confirmed" as const };
    const [event] = await tx.insert(paymentWebhookEventsTable).values({
      provider: "chapa",
      eventId,
      payloadHash,
    }).onConflictDoNothing().returning();
    if (!event) return { kind: "duplicate-event" as const, payment };

    const [request] = await tx.select().from(serviceRequestsTable)
      .where(eq(serviceRequestsTable.id, booking.requestId)).limit(1);
    if (!request) throw new Error("Verified payment references a missing service request.");
    const [pricing] = await tx.select().from(pricingRulesTable)
      .where(eq(pricingRulesTable.categoryId, request.categoryId)).limit(1);
    if (!pricing) throw new Error("Payment commission cannot be calculated without pricing rules.");
    const amount = Number(payment.amount);
    const commission = Math.round(amount * Number(pricing.platformCommissionRate) * 100) / 100;
    const providerEarning = Math.round((amount - commission) * 100) / 100;
    await tx.update(paymentsTable).set({ status: "COMPLETED", verifiedAt: new Date(), failureReason: null })
      .where(eq(paymentsTable.id, payment.id));
    await tx.update(bookingsTable).set({ status: "PAID", updatedAt: new Date() }).where(eq(bookingsTable.id, booking.id));
    await tx.update(serviceRequestsTable).set({ status: "PAID", updatedAt: new Date() })
      .where(eq(serviceRequestsTable.id, request.id));
    await tx.insert(bookingStatusHistoryTable).values({ bookingId: booking.id, status: "PAID" });
    const [provider] = await tx.select({ userId: technicianProfilesTable.userId })
      .from(technicianProfilesTable)
      .where(eq(technicianProfilesTable.id, booking.technicianId))
      .limit(1);
    const entries = [
      {
        bookingId: booking.id,
        userId: booking.customerId,
        type: "CUSTOMER_PAYMENT" as const,
        amount: String(amount),
        idempotencyKey: `payment:${payment.id}:customer`,
      },
      {
        bookingId: booking.id,
        type: "PLATFORM_COMMISSION" as const,
        amount: String(commission),
        idempotencyKey: `payment:${payment.id}:commission`,
      },
      {
        bookingId: booking.id,
        userId: provider?.userId,
        type: "PROVIDER_EARNING" as const,
        amount: String(providerEarning),
        idempotencyKey: `payment:${payment.id}:provider`,
      },
    ].filter((entry) => Number(entry.amount) > 0);
    if (entries.length) await tx.insert(ledgerEntriesTable).values(entries);
    await tx.insert(auditLogsTable).values({
      actorId: null,
      action: "PAYMENT_VERIFIED",
      entityType: "payment",
      entityId: payment.id,
      metadata: { provider: "chapa", transactionId, amount },
    });
    return { kind: "completed" as const, payment };
  });
}

async function requestResponse(request: typeof serviceRequestsTable.$inferSelect) {
  const [category] = await db.select({ slug: serviceCategoriesTable.slug }).from(serviceCategoriesTable).where(eq(serviceCategoriesTable.id, request.categoryId)).limit(1);
  const presentation = presentationFor(category?.slug ?? "");
  const [problem, description = ""] = request.problemDescription.split("\n");
  return {
    serviceSlug: category?.slug ?? "",
    problem,
    description,
    address: request.address,
    id: request.id,
    status: request.status,
    urgency: request.urgency,
    preferredAt: request.preferredAt?.toISOString() ?? null,
    problemPhotos: request.problemPhotos ?? [],
    latitude: request.latitude === null ? null : Number(request.latitude),
    longitude: request.longitude === null ? null : Number(request.longitude),
    budgetMin: request.budgetMin === null ? null : Number(request.budgetMin),
    budgetMax: request.budgetMax === null ? null : Number(request.budgetMax),
    createdAt: request.createdAt.toISOString(),
    priceMin: Number(request.estimatedPriceMin),
    priceMax: Number(request.estimatedPriceMax),
    arrival: presentation.arrival,
  };
}

async function bookingResponse(booking: typeof bookingsTable.$inferSelect) {
  const [request] = await db.select().from(serviceRequestsTable).where(eq(serviceRequestsTable.id, booking.requestId)).limit(1);
  const [provider] = await db.select({ name: usersTable.fullName }).from(technicianProfilesTable).innerJoin(usersTable, eq(technicianProfilesTable.userId, usersTable.id)).where(eq(technicianProfilesTable.id, booking.technicianId)).limit(1);
  const requestView = request ? await requestResponse(request) : undefined;
  return { id: booking.id, requestId: booking.requestId, technicianId: booking.technicianId, technicianName: provider?.name ?? "Provider", serviceName: requestView?.serviceSlug ?? "Service", address: request?.address ?? "", status: booking.status, priceMin: requestView?.priceMin ?? 0, priceMax: requestView?.priceMax ?? 0, finalPrice: booking.finalPrice === null ? null : Number(booking.finalPrice), eta: "Provider will confirm", createdAt: booking.createdAt.toISOString(), progress: booking.status === "COMPLETED" ? 100 : booking.status === "IN_PROGRESS" ? 75 : booking.status === "ARRIVED" ? 55 : 25 };
}

router.get("/services", async (req, res, next) => {
  const query = z.object({ q: z.string().trim().max(120).optional() }).safeParse(req.query);
  if (!query.success) return res.status(400).json({ error: "Invalid service search." });
  try {
    const filters = [eq(serviceCategoriesTable.isActive, true)];
    if (query.data.q) {
      const term = `%${query.data.q.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
      filters.push(or(ilike(serviceCategoriesTable.name, term), ilike(serviceCategoriesTable.description, term))!);
    }
    const rows = await db.select({ category: serviceCategoriesTable, pricing: pricingRulesTable })
      .from(serviceCategoriesTable)
      .leftJoin(pricingRulesTable, eq(pricingRulesTable.categoryId, serviceCategoriesTable.id))
      .where(and(...filters));
    if (rows.some(({ pricing }) => !pricing)) return res.status(503).json({ error: "Service pricing is not configured." });
    return res.json(rows.map(({ category, pricing }) => {
      const presentation = presentationFor(category.slug);
      return {
        id: category.id,
        slug: category.slug,
        name: category.name,
        description: category.description ?? "",
        icon: category.iconName,
        startingPrice: Number(pricing!.basePriceMin),
        priceMax: Number(pricing!.basePriceMax),
        arrival: presentation.arrival,
        accent: presentation.accent,
      };
    }));
  } catch (error) { return next(error); }
});

router.get("/technicians", requireAuth, async (req, res, next) => {
  const parsed = ListTechniciansQueryParams.extend({
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
  }).refine((filters) => (filters.latitude === undefined) === (filters.longitude === undefined), {
    message: "Latitude and longitude must be supplied together.",
  }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Invalid technician filters." });
  try {
    const serviceSlug = parsed.data.serviceSlug;
    const requestId = parsed.data.requestId;
    let requestedCategoryId: string | undefined;
    let scheduledRequest: {
      categoryId: string;
      latitude: string | null;
      longitude: string | null;
      preferredAt: Date | null;
      budgetMin: string | null;
      budgetMax: string | null;
      isEmergency: boolean;
    } | undefined;
    if (serviceSlug) {
      const [category] = await db.select({ id: serviceCategoriesTable.id }).from(serviceCategoriesTable).where(eq(serviceCategoriesTable.slug, serviceSlug)).limit(1);
      requestedCategoryId = category?.id;
      if (!requestedCategoryId) return res.json([]);
    }
    let searchLatitude = parsed.data.latitude;
    let searchLongitude = parsed.data.longitude;
    if (requestId) {
      const [request] = await db.select({
        customerId: serviceRequestsTable.customerId,
        categoryId: serviceRequestsTable.categoryId,
        latitude: serviceRequestsTable.latitude,
        longitude: serviceRequestsTable.longitude,
        preferredAt: serviceRequestsTable.preferredAt,
        budgetMin: serviceRequestsTable.budgetMin,
        budgetMax: serviceRequestsTable.budgetMax,
        isEmergency: serviceRequestsTable.isEmergency,
      }).from(serviceRequestsTable).where(eq(serviceRequestsTable.id, requestId)).limit(1);
      if (!request || (request.customerId !== currentUser(req)!.id && !currentUser(req)!.roles.includes("ADMIN"))) {
        return res.status(404).json({ error: "Request not found." });
      }
      requestedCategoryId = request.categoryId;
      scheduledRequest = request;
      searchLatitude = request.latitude === null ? searchLatitude : Number(request.latitude);
      searchLongitude = request.longitude === null ? searchLongitude : Number(request.longitude);
    }
    const ranked = requestedCategoryId
      ? await providerMatching.findMatches(scheduledRequest ?? {
        categoryId: requestedCategoryId,
        latitude: searchLatitude === undefined ? null : String(searchLatitude),
        longitude: searchLongitude === undefined ? null : String(searchLongitude),
        preferredAt: null,
        budgetMin: null,
        budgetMax: null,
        isEmergency: false,
      })
      : await db.select({ profile: technicianProfilesTable, name: usersTable.fullName })
        .from(technicianProfilesTable)
        .innerJoin(usersTable, eq(technicianProfilesTable.userId, usersTable.id))
        .where(and(
          eq(technicianProfilesTable.verificationStatus, "VERIFIED"),
          eq(technicianProfilesTable.isAvailable, true),
          eq(usersTable.isActive, true),
        )).then((rows) => rows.map(({ profile, name }) => ({ profile, name, distanceKm: null })));
    return res.json(ranked.filter(({ profile }) => profile.userId !== currentUser(req)!.id).map(({ profile, name, distanceKm }) => ({
      id: profile.id,
      name,
      initials: name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase(),
      rating: profile.ratingCount > 0 ? Number(profile.ratingAvg) : 0,
      reviews: profile.ratingCount,
      verified: true,
      distance: distanceKm === null ? "Distance unavailable" : `${distanceKm.toFixed(1)} km`,
      eta: "Provider will confirm",
      earnings: "Ask provider",
      specialty: profile.serviceArea ?? "Local services",
      available: profile.isAvailable,
    })));
  } catch (error) { return next(error); }
});

router.get("/service-requests", requireAuth, async (req, res, next) => {
  try {
    const user = currentUser(req)!;
    const rows = user.roles.includes("ADMIN") ? await db.select().from(serviceRequestsTable) : await db.select().from(serviceRequestsTable).where(eq(serviceRequestsTable.customerId, user.id));
    return res.json(await Promise.all(rows.map(requestResponse)));
  } catch (error) { return next(error); }
});

router.post("/service-requests", requireRole("CUSTOMER"), async (req, res, next) => {
  const parsed = CreateServiceRequestBody.extend({
    preferredAt: z.string().datetime().optional(),
    budgetMin: z.number().nonnegative().optional(),
    budgetMax: z.number().nonnegative().optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    problemPhotos: z.array(z.string().url()).max(5).optional(),
  }).refine((value) => value.budgetMin === undefined || value.budgetMax === undefined || value.budgetMax >= value.budgetMin, {
    message: "Maximum budget must be at least the minimum budget.",
  }).refine((value) => (value.latitude === undefined) === (value.longitude === undefined), {
    message: "Latitude and longitude must be supplied together.",
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Please complete the request details." });
  const suppliedKey = req.get("idempotency-key");
  if (suppliedKey !== undefined && !z.string().trim().min(8).max(120).safeParse(suppliedKey).success) {
    return res.status(400).json({ error: "Invalid Idempotency-Key header." });
  }
  const idempotencyKey = suppliedKey
    ? `${currentUser(req)!.id}:${suppliedKey.trim()}`
    : undefined;
  const payloadHash = createHash("sha256").update(JSON.stringify(parsed.data)).digest("hex");
  try {
    if (idempotencyKey) {
      const [existing] = await db.select().from(serviceRequestsTable)
        .where(eq(serviceRequestsTable.idempotencyKey, idempotencyKey)).limit(1);
      if (existing) {
        if (existing.customerId !== currentUser(req)!.id || existing.payloadHash !== payloadHash) {
          return res.status(409).json({ error: "Idempotency key was already used for a different request." });
        }
        return res.status(200).json(await requestResponse(existing));
      }
    }
    const [category] = await db.select().from(serviceCategoriesTable).where(eq(serviceCategoriesTable.slug, parsed.data.serviceSlug)).limit(1);
    if (!category) return res.status(400).json({ error: "That service is not available." });
    const [pricing] = await db.select().from(pricingRulesTable).where(eq(pricingRulesTable.categoryId, category.id)).limit(1);
    if (!pricing) return res.status(503).json({ error: "Pricing is not configured for that service." });
    const presentation = presentationFor(category.slug);
    const estimate = calculateEstimate({
      baseMin: Number(pricing.basePriceMin),
      baseMax: Number(pricing.basePriceMax),
      emergencyFee: Number(pricing.emergencyFee),
      commissionRate: Number(pricing.platformCommissionRate),
      customerFee: Number(pricing.customerFee),
      includedDistanceKm: Number(pricing.includedDistanceKm),
      perKmRate: Number(pricing.perKmRate),
    }, { isEmergency: parsed.data.urgency === "Emergency", distanceKm: 0 });
    if (parsed.data.preferredAt && new Date(parsed.data.preferredAt) <= new Date()) return res.status(400).json({ error: "Preferred service time must be in the future." });
    if (parsed.data.urgency === "Emergency") return res.status(400).json({ error: "Use the dedicated emergency dispatch flow for emergencies." });
    const candidates = (await providerMatching.findMatches({
      categoryId: category.id,
      latitude: parsed.data.latitude === undefined ? null : String(parsed.data.latitude),
      longitude: parsed.data.longitude === undefined ? null : String(parsed.data.longitude),
      preferredAt: parsed.data.preferredAt ? new Date(parsed.data.preferredAt) : null,
      budgetMin: parsed.data.budgetMin === undefined ? null : String(parsed.data.budgetMin),
      budgetMax: parsed.data.budgetMax === undefined ? null : String(parsed.data.budgetMax),
      isEmergency: false,
    }))
      .filter(({ profile }) => profile.userId !== currentUser(req)!.id)
      .slice(0, 10);
    const request = await db.transaction(async (tx) => {
      const [created] = await tx.insert(serviceRequestsTable).values({
        customerId: currentUser(req)!.id,
        categoryId: category.id,
        idempotencyKey,
        payloadHash: idempotencyKey ? payloadHash : undefined,
        status: candidates.length > 0 ? "SEARCHING" : "REQUESTED",
        problemDescription: `${parsed.data.problem}\n${parsed.data.description}`,
        address: parsed.data.address,
        problemPhotos: parsed.data.problemPhotos ?? [],
        latitude: parsed.data.latitude === undefined ? null : String(parsed.data.latitude),
        longitude: parsed.data.longitude === undefined ? null : String(parsed.data.longitude),
        preferredAt: parsed.data.preferredAt ? new Date(parsed.data.preferredAt) : null,
        budgetMin: parsed.data.budgetMin === undefined ? null : String(parsed.data.budgetMin),
        budgetMax: parsed.data.budgetMax === undefined ? null : String(parsed.data.budgetMax),
        urgency: parsed.data.urgency ?? "STANDARD",
        isEmergency: false,
        estimatedPriceMin: String(estimate.minPrice),
        estimatedPriceMax: String(estimate.maxPrice),
      }).returning();
      if (!created) throw new Error("Could not create the request.");
      if (candidates.length > 0) {
        await tx.insert(providerOffersTable).values(candidates.map(({ profile }) => ({
          requestId: created.id,
          technicianId: profile.id,
          status: "OFFERED" as const,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        }))).onConflictDoNothing();
        await tx.insert(notificationsTable).values(candidates.map(({ profile }) => ({
          userId: profile.userId,
          type: "SERVICE_REQUEST",
          title: "New service request",
          body: `A customer is looking for help with ${category.name}.`,
          payload: { requestId: created.id, serviceSlug: category.slug },
        })));
      }
      return created;
    });
    return res.status(201).json({ ...(await requestResponse(request)), priceMin: estimate.minPrice, priceMax: estimate.maxPrice, arrival: presentation.arrival });
  } catch (error) {
    if (idempotencyKey && typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      const [existing] = await db.select().from(serviceRequestsTable)
        .where(eq(serviceRequestsTable.idempotencyKey, idempotencyKey)).limit(1);
      if (existing && existing.customerId === currentUser(req)!.id && existing.payloadHash === payloadHash) {
        return res.status(200).json(await requestResponse(existing));
      }
      return res.status(409).json({ error: "Idempotency key was already used for a different request." });
    }
    return next(error);
  }
});

router.post("/bookings", requireRole("CUSTOMER"), async (req, res, next) => {
  const parsed = CreateBookingBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose a technician to continue." });
  try {
    const user = currentUser(req)!;
    const [request] = await db.select().from(serviceRequestsTable).where(and(eq(serviceRequestsTable.id, parsed.data.requestId), eq(serviceRequestsTable.customerId, user.id))).limit(1);
    const [technicianRow] = await db.select({ profile: technicianProfilesTable, userId: usersTable.id }).from(technicianProfilesTable).innerJoin(usersTable, eq(technicianProfilesTable.userId, usersTable.id)).where(and(or(eq(technicianProfilesTable.id, parsed.data.technicianId), eq(technicianProfilesTable.userId, parsed.data.technicianId)), eq(usersTable.isActive, true))).limit(1);
    const technician = technicianRow?.profile;
    if (!request || !technician || technicianRow.userId === currentUser(req)!.id || !technician.isAvailable || technician.verificationStatus !== "VERIFIED") return res.status(404).json({ error: "We couldn't find that request or provider." });
    const [skill] = await db.select({ categoryId: technicianSkillsTable.categoryId }).from(technicianSkillsTable)
      .where(and(eq(technicianSkillsTable.technicianId, technician.id), eq(technicianSkillsTable.categoryId, request.categoryId)))
      .limit(1);
    if (!skill) return res.status(409).json({ error: "That provider does not list the requested service." });
    const booking = await db.transaction(async (tx) => {
      const [lockedRequest] = await tx.select().from(serviceRequestsTable)
        .where(and(eq(serviceRequestsTable.id, request.id), eq(serviceRequestsTable.customerId, user.id)))
        .limit(1)
        .for("update");
      if (!lockedRequest || !["REQUESTED", "SEARCHING"].includes(lockedRequest.status)) return undefined;
      const [created] = await tx.insert(bookingsTable).values({
        requestId: lockedRequest.id,
        customerId: user.id,
        technicianId: technician.id,
        status: "ASSIGNED",
      }).returning();
      if (!created) return undefined;
      await tx.update(serviceRequestsTable).set({ technicianId: technician.id, status: "ASSIGNED", updatedAt: new Date() }).where(eq(serviceRequestsTable.id, lockedRequest.id));
      await tx.insert(bookingStatusHistoryTable).values({ bookingId: created.id, status: "ASSIGNED", changedBy: user.id });
      await tx.insert(conversationsTable).values({ bookingId: created.id });
      const [providerUser] = await tx.select({ userId: technicianProfilesTable.userId })
        .from(technicianProfilesTable).where(eq(technicianProfilesTable.id, technician.id)).limit(1);
      if (providerUser) {
        await tx.insert(notificationsTable).values({
          userId: providerUser.userId,
          type: "BOOKING_ASSIGNED",
          title: "New booking",
          body: "A customer selected you for a service booking.",
          payload: { bookingId: created.id },
        });
      }
      return created;
    });
    return booking ? res.status(201).json(await bookingResponse(booking)) : res.status(409).json({ error: "This service request has already been booked or is no longer available." });
  } catch (error) { return next(error); }
});

router.get("/bookings/:id", requireAuth, async (req, res, next) => {
  const parsed = GetBookingParams.safeParse(req.params);
  if (!parsed.success) return res.status(404).json({ error: "Booking not found." });
  try {
    const user = currentUser(req)!;
    const [provider] = await db.select({ id: technicianProfilesTable.id }).from(technicianProfilesTable).where(eq(technicianProfilesTable.userId, user.id)).limit(1);
    const participant = provider
      ? or(eq(bookingsTable.customerId, user.id), eq(bookingsTable.technicianId, provider.id))
      : eq(bookingsTable.customerId, user.id);
    const condition = user.roles.includes("ADMIN")
      ? eq(bookingsTable.id, parsed.data.id)
      : and(eq(bookingsTable.id, parsed.data.id), participant);
    const [booking] = await db.select().from(bookingsTable).where(condition).limit(1);
    return booking ? res.json(await bookingResponse(booking)) : res.status(404).json({ error: "Booking not found." });
  } catch (error) { return next(error); }
});

router.patch("/bookings/:id/status", requireAuth, async (req, res, next) => {
  const params = UpdateBookingStatusParams.safeParse(req.params);
  const body = UpdateBookingStatusBody.extend({
    quotedPrice: z.number().positive().optional(),
  }).safeParse(req.body);
  if (!params.success || !body.success) return res.status(400).json({ error: "Invalid booking status." });
  try {
    const user = currentUser(req)!;
    const result = await db.transaction(async (tx) => {
      const [booking] = await tx.select().from(bookingsTable).where(eq(bookingsTable.id, params.data.id)).limit(1).for("update");
      if (!booking) return { kind: "not-found" as const };
      const [provider] = await tx.select({ userId: technicianProfilesTable.userId }).from(technicianProfilesTable)
        .where(eq(technicianProfilesTable.id, booking.technicianId)).limit(1);
      if (["PAID", "REFUNDED", "RATED"].includes(body.data.status)) return { kind: "protected-transition" as const };
      const customerStatuses = ["CUSTOMER_CONFIRMED", "DISPUTED", "CANCELLED"];
      const providerStatuses = ["ACCEPTED", "TECHNICIAN_EN_ROUTE", "ARRIVED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "DISPUTED"];
      const authorized = (booking.customerId === user.id && customerStatuses.includes(body.data.status))
        || (provider?.userId === user.id && providerStatuses.includes(body.data.status));
      if (!authorized) return { kind: "forbidden" as const };
      if (!canTransition(booking.status, body.data.status)) return { kind: "invalid-transition" as const, current: booking.status };
      let finalPrice = booking.finalPrice;
      if (body.data.status === "ACCEPTED" && provider?.userId === user.id) {
        const [request] = await tx.select().from(serviceRequestsTable)
          .where(eq(serviceRequestsTable.id, booking.requestId)).limit(1);
        const [pricing] = request
          ? await tx.select({
            pricingModel: technicianServicePricingTable.pricingModel,
            amount: technicianServicePricingTable.amount,
            minimumCharge: technicianServicePricingTable.minimumCharge,
          }).from(technicianServicePricingTable).where(and(
            eq(technicianServicePricingTable.technicianId, booking.technicianId),
            eq(technicianServicePricingTable.categoryId, request.categoryId),
          )).limit(1)
          : [];
        const resolved = resolveProviderPrice(pricing, body.data.quotedPrice);
        if ("error" in resolved) return { kind: "invalid-price" as const, error: resolved.error };
        if (request?.budgetMax !== null && request?.budgetMax !== undefined && resolved.price > Number(request.budgetMax)) {
          return { kind: "over-budget" as const };
        }
        finalPrice = String(resolved.price);
      }
      if (body.data.status === "CUSTOMER_CONFIRMED" && booking.finalPrice === null) return { kind: "missing-price" as const };
      if (body.data.status === "COMPLETED" && booking.finalPrice === null) return { kind: "missing-price" as const };
      const [updated] = await tx.update(bookingsTable).set({ status: body.data.status, finalPrice, updatedAt: new Date() })
        .where(eq(bookingsTable.id, booking.id)).returning();
      if (!updated) throw new Error("Booking state update returned no row.");
      await tx.update(serviceRequestsTable).set({
        status: body.data.status,
        ...(body.data.status === "ACCEPTED" && finalPrice !== null ? { finalPrice } : {}),
        updatedAt: new Date(),
      })
        .where(eq(serviceRequestsTable.id, booking.requestId));
      await tx.insert(bookingStatusHistoryTable).values({
        bookingId: booking.id,
        status: body.data.status,
        changedBy: user.id,
      });
      const recipientId = booking.customerId === user.id ? provider?.userId : booking.customerId;
      if (recipientId) {
        await tx.insert(notificationsTable).values({
          userId: recipientId,
          type: "BOOKING_UPDATE",
          title: "Booking updated",
          body: `Your booking status is now ${body.data.status.toLowerCase().replaceAll("_", " ")}.`,
          payload: { bookingId: booking.id, status: body.data.status },
        });
      }
      if (body.data.status === "COMPLETED") {
        await tx.insert(serviceGuaranteesTable).values({
          bookingId: booking.id,
          guaranteeDays: 7,
          validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          status: "ACTIVE",
        }).onConflictDoNothing();
        await tx.insert(loyaltyAccountsTable).values({ customerId: booking.customerId, points: 0 }).onConflictDoNothing();
        const [account] = await tx.select().from(loyaltyAccountsTable)
          .where(eq(loyaltyAccountsTable.customerId, booking.customerId)).limit(1).for("update");
        if (account) {
          const reason = `Completed service ${booking.id}`;
          const [reward] = await tx.select().from(loyaltyTransactionsTable)
            .where(and(eq(loyaltyTransactionsTable.accountId, account.id), eq(loyaltyTransactionsTable.reason, reason)))
            .limit(1);
          if (!reward) {
            await tx.insert(loyaltyTransactionsTable).values({ accountId: account.id, points: 100, reason });
            await tx.update(loyaltyAccountsTable).set({ points: account.points + 100, updatedAt: new Date() })
              .where(eq(loyaltyAccountsTable.id, account.id));
          }
        }
      }
      return { kind: "updated" as const, booking: updated };
    });
    if (result.kind === "not-found") return res.status(404).json({ error: "Booking not found." });
    if (result.kind === "forbidden") return res.status(403).json({ error: "You cannot make that job update." });
    if (result.kind === "invalid-transition") return res.status(409).json({ error: `A job cannot move from ${result.current} to ${body.data.status}.` });
    if (result.kind === "protected-transition") return res.status(409).json({ error: "Payment, refund, and review states are controlled by their dedicated workflows." });
    if (result.kind === "invalid-price") return res.status(409).json({ error: result.error });
    if (result.kind === "over-budget") return res.status(409).json({ error: "The provider's price exceeds the customer's budget." });
    if (result.kind === "missing-price") return res.status(409).json({ error: "A provider-confirmed final price is required before this status change." });
    return res.json(await bookingResponse(result.booking));
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
  const body = z.object({ phoneNumber: z.string().min(9), email: z.string().email(), returnUrl: z.string().url() }).safeParse(req.body);
  if (!parsed.success || !body.success) return res.status(400).json({ error: "Provide valid payment details." });
  try {
    const user = currentUser(req)!;
    const [booking] = await db.select().from(bookingsTable)
      .where(and(eq(bookingsTable.id, parsed.data.id), eq(bookingsTable.customerId, user.id)))
      .limit(1);
    if (!booking) return res.status(404).json({ error: "Booking not found." });
    if (booking.status !== "CUSTOMER_CONFIRMED") return res.status(409).json({ error: "Payment is available after the customer confirms the completed job." });
    const [request] = await db.select().from(serviceRequestsTable).where(eq(serviceRequestsTable.id, booking.requestId)).limit(1);
    if (!request) return res.status(404).json({ error: "Service request not found." });
    const amount = Number(booking.finalPrice ?? request.estimatedPriceMax);
    const allowedOrigins = new Set<string>();
    if (process.env.PUBLIC_APP_URL) allowedOrigins.add(new URL(process.env.PUBLIC_APP_URL).origin);
    const requestOrigin = req.get("origin");
    if (requestOrigin) allowedOrigins.add(new URL(requestOrigin).origin);
    if (process.env.NODE_ENV === "production" && !allowedOrigins.has(new URL(body.data.returnUrl).origin)) {
      return res.status(400).json({ error: "Payment return URL must belong to this application." });
    }
    const reservation = await db.transaction(async (tx) => {
      const [lockedBooking] = await tx.select().from(bookingsTable)
        .where(and(eq(bookingsTable.id, booking.id), eq(bookingsTable.customerId, user.id)))
        .limit(1)
        .for("update");
      if (!lockedBooking || lockedBooking.status !== "CUSTOMER_CONFIRMED") return { kind: "booking-changed" as const };
      let [record] = await tx.select().from(paymentsTable)
        .where(eq(paymentsTable.bookingId, lockedBooking.id)).limit(1).for("update");
      if (record?.status === "COMPLETED") return { kind: "already-paid" as const };
      if (record?.status === "PROCESSING") return { kind: "processing" as const };
      if (record?.status === "PENDING" && record.checkoutUrl && record.providerReference) {
        return { kind: "ready" as const, record };
      }
      if (record) {
        [record] = await tx.update(paymentsTable).set({
          amount: String(amount),
          provider: paymentProvider.name,
          providerReference: null,
          checkoutUrl: null,
          status: "PROCESSING",
          failureReason: null,
          verifiedAt: null,
          createdAt: new Date(),
        }).where(eq(paymentsTable.id, record.id)).returning();
      } else {
        [record] = await tx.insert(paymentsTable).values({
          bookingId: lockedBooking.id,
          amount: String(amount),
          provider: paymentProvider.name,
          status: "PROCESSING",
        }).returning();
      }
      return record ? { kind: "reserved" as const, record } : { kind: "failed" as const };
    });
    if (reservation.kind === "booking-changed") return res.status(409).json({ error: "Booking state changed; reload and retry payment." });
    if (reservation.kind === "already-paid") return res.status(409).json({ error: "This booking is already paid." });
    if (reservation.kind === "processing") return res.status(409).json({ error: "A payment attempt is already in progress." });
    if (reservation.kind === "failed") return res.status(500).json({ error: "Could not reserve a payment attempt." });
    if (reservation.kind === "ready") return res.status(202).json({
      paymentId: reservation.record.id,
      transactionId: reservation.record.providerReference,
      status: reservation.record.status,
      redirectUrl: reservation.record.checkoutUrl,
    });

    try {
      const [customer] = await db.select({ fullName: usersTable.fullName }).from(usersTable)
        .where(eq(usersTable.id, user.id)).limit(1);
      const names = (customer?.fullName ?? "Melse customer").trim().split(/\s+/);
      const payment = await paymentProvider.initiatePayment({
        bookingId: booking.id,
        amount,
        currency: "ETB",
        phoneNumber: body.data.phoneNumber,
        email: body.data.email,
        firstName: names[0] ?? "Customer",
        lastName: names.slice(1).join(" ") || "Melse",
        returnUrl: body.data.returnUrl,
      });
      const [record] = await db.update(paymentsTable).set({
        providerReference: payment.transactionId,
        checkoutUrl: payment.redirectUrl ?? null,
        status: payment.status === "FAILED" ? "FAILED" : "PENDING",
      }).where(and(eq(paymentsTable.id, reservation.record.id), eq(paymentsTable.status, "PROCESSING"))).returning();
      if (!record || !payment.redirectUrl) throw new Error("Payment attempt could not be persisted.");
      return res.status(202).json({
        paymentId: record.id,
        transactionId: payment.transactionId,
        status: record.status,
        redirectUrl: payment.redirectUrl,
      });
    } catch (error) {
      await db.update(paymentsTable).set({
        status: "FAILED",
        failureReason: error instanceof Error ? error.message.slice(0, 500) : "Payment initialization failed.",
      }).where(eq(paymentsTable.id, reservation.record.id));
      if (error instanceof PaymentProviderUnavailableError) return res.status(503).json({ error: error.message });
      if (error instanceof PaymentProviderRequestError) return res.status(502).json({ error: error.message });
      return next(error);
    }
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
    if (payment.status === "COMPLETED") return res.json({ transactionId: transactionId.data, status: "SUCCESS", verified: true });
    const verified = await paymentProvider.verifyPayment(transactionId.data);
    if (!verified) return res.json({ transactionId: transactionId.data, status: "PENDING", verified: false });
    const result = await completeVerifiedPayment(
      transactionId.data,
      `verify:${transactionId.data}`,
      createHash("sha256").update(`verify:${transactionId.data}`).digest("hex"),
      verified,
    );
    if (result.kind === "not-found") return res.status(404).json({ error: "Payment not found." });
    if (result.kind === "booking-not-confirmed") return res.status(409).json({ error: "Booking must be customer-confirmed before payment can settle." });
    if (result.kind === "verification-mismatch") return res.status(409).json({ error: "The verified payment details do not match the amount due; contact support." });
    return res.json({ transactionId: transactionId.data, status: "SUCCESS", verified: true });
  } catch (error) {
    if (error instanceof PaymentProviderUnavailableError) return res.status(503).json({ error: error.message });
    if (error instanceof PaymentProviderRequestError) return res.status(502).json({ error: error.message });
    return next(error);
  }
});

router.post("/payments/chapa/webhook", async (req, res, next) => {
  const webhookSecret = process.env.CHAPA_WEBHOOK_SECRET;
  const signature = req.get("x-chapa-signature");
  const rawBody = (req as typeof req & { rawBody?: Buffer }).rawBody;
  if (!webhookSecret) return res.status(503).json({ error: "Payment webhook verification is not configured." });
  if (!signature || !rawBody) return res.status(401).json({ error: "Invalid payment webhook signature." });
  const expected = createHmac("sha256", webhookSecret).update(rawBody).digest();
  let received: Buffer;
  try {
    received = Buffer.from(signature, "hex");
  } catch {
    return res.status(401).json({ error: "Invalid payment webhook signature." });
  }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return res.status(401).json({ error: "Invalid payment webhook signature." });
  }
  const body = z.object({
    tx_ref: z.string().min(1).max(100),
    status: z.string().min(1).max(40),
  }).passthrough().safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Invalid payment webhook payload." });
  try {
    const verified = await paymentProvider.verifyPayment(body.data.tx_ref);
    if (!verified) return res.status(202).json({ received: true, settled: false });
    const payloadHash = createHash("sha256").update(rawBody).digest("hex");
    const result = await completeVerifiedPayment(
      body.data.tx_ref,
      `${body.data.tx_ref}:${body.data.status}:${payloadHash}`,
      payloadHash,
      verified,
    );
    if (result.kind === "not-found") return res.status(404).json({ error: "Payment reference not found." });
    if (result.kind === "booking-not-confirmed") return res.status(409).json({ error: "Booking must be customer-confirmed before payment can settle." });
    if (result.kind === "verification-mismatch") return res.status(409).json({ error: "The verified payment details do not match the amount due." });
    return res.status(200).json({ received: true, settled: true });
  } catch (error) {
    if (error instanceof PaymentProviderUnavailableError) return res.status(503).json({ error: error.message });
    if (error instanceof PaymentProviderRequestError) return res.status(502).json({ error: error.message });
    return next(error);
  }
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
  const parsed = z.object({
    basePriceMin: z.number().nonnegative(),
    basePriceMax: z.number().nonnegative(),
    emergencyFee: z.number().nonnegative(),
    customerFee: z.number().nonnegative().optional(),
    includedDistanceKm: z.number().nonnegative().optional(),
    perKmRate: z.number().nonnegative().optional(),
    platformCommissionRate: z.number().min(0).max(1),
  }).refine((value) => value.basePriceMax >= value.basePriceMin).safeParse(req.body);
  if (!id.success || !parsed.success) return res.status(400).json({ error: "Invalid pricing rule." });
  try {
    const [pricing] = await db.update(pricingRulesTable).set({
      basePriceMin: String(parsed.data.basePriceMin),
      basePriceMax: String(parsed.data.basePriceMax),
      emergencyFee: String(parsed.data.emergencyFee),
      customerFee: parsed.data.customerFee === undefined ? undefined : String(parsed.data.customerFee),
      includedDistanceKm: parsed.data.includedDistanceKm === undefined ? undefined : String(parsed.data.includedDistanceKm),
      perKmRate: parsed.data.perKmRate === undefined ? undefined : String(parsed.data.perKmRate),
      platformCommissionRate: String(parsed.data.platformCommissionRate),
      updatedAt: new Date(),
    }).where(eq(pricingRulesTable.id, id.data)).returning();
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
