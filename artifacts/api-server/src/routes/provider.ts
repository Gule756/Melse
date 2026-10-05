import { Router, type IRouter } from "express";
import { and, eq, gt, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import {
  bookingsTable,
  bookingStatusHistoryTable,
  conversationsTable,
  db,
  emergencyRequestsTable,
  notificationsTable,
  providerAvailabilityTable,
  providerOffersTable,
  serviceCategoriesTable,
  serviceRequestsTable,
  technicianProfilesTable,
  technicianServicePricingTable,
  technicianSkillsTable,
  usersTable,
} from "@workspace/db";
import { currentUser, requireRole } from "../middlewares/auth";
import { resolveProviderPrice } from "../lib/pricing";

const router: IRouter = Router();

const servicePricingInput = z.object({
  categorySlug: z.string().trim().min(1).max(50),
  pricingModel: z.enum(["FIXED", "HOURLY", "QUOTE"]),
  amount: z.number().nonnegative().nullable(),
  minimumCharge: z.number().nonnegative().nullable().optional(),
}).refine((item) => item.pricingModel === "QUOTE" ? item.amount === null : item.amount !== null, {
  message: "Fixed and hourly prices require an amount; quote pricing must not include one.",
});

const availabilityInput = z.array(z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startsAt: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  endsAt: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  isAvailable: z.boolean().default(true),
}).refine((slot) => slot.startsAt < slot.endsAt, {
  message: "Availability end time must be after its start time.",
})).max(42);

router.get("/provider/services", requireRole("PROVIDER"), async (req, res, next) => {
  try {
    const [profile] = await db.select({ id: technicianProfilesTable.id })
      .from(technicianProfilesTable)
      .where(eq(technicianProfilesTable.userId, currentUser(req)!.id))
      .limit(1);
    if (!profile) return res.status(404).json({ error: "Provider profile not found." });
    const services = await db.select({
      categorySlug: serviceCategoriesTable.slug,
      categoryName: serviceCategoriesTable.name,
      pricingModel: technicianServicePricingTable.pricingModel,
      amount: technicianServicePricingTable.amount,
      minimumCharge: technicianServicePricingTable.minimumCharge,
    }).from(technicianSkillsTable)
      .innerJoin(serviceCategoriesTable, eq(technicianSkillsTable.categoryId, serviceCategoriesTable.id))
      .leftJoin(technicianServicePricingTable, and(
        eq(technicianServicePricingTable.technicianId, technicianSkillsTable.technicianId),
        eq(technicianServicePricingTable.categoryId, technicianSkillsTable.categoryId),
      ))
      .where(eq(technicianSkillsTable.technicianId, profile.id));
    return res.json(services);
  } catch (error) {
    return next(error);
  }
});

router.put("/provider/services", requireRole("PROVIDER"), async (req, res, next) => {
  const parsed = z.object({ services: z.array(servicePricingInput).max(100) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Provide valid provider services and pricing." });
  const slugs = parsed.data.services.map(({ categorySlug }) => categorySlug);
  if (new Set(slugs).size !== slugs.length) return res.status(400).json({ error: "Each service may only appear once." });

  try {
    const [profile] = await db.select().from(technicianProfilesTable)
      .where(eq(technicianProfilesTable.userId, currentUser(req)!.id))
      .limit(1);
    if (!profile) return res.status(404).json({ error: "Provider profile not found." });
    const categories = slugs.length
      ? await db.select({ id: serviceCategoriesTable.id, slug: serviceCategoriesTable.slug })
        .from(serviceCategoriesTable)
        .where(and(eq(serviceCategoriesTable.isActive, true), inArray(serviceCategoriesTable.slug, slugs)))
      : [];
    if (categories.length !== slugs.length) return res.status(400).json({ error: "One or more services are unavailable." });
    const categoryBySlug = new Map(categories.map((category) => [category.slug, category.id]));

    const result = await db.transaction(async (tx) => {
      await tx.delete(technicianSkillsTable).where(eq(technicianSkillsTable.technicianId, profile.id));
      await tx.delete(technicianServicePricingTable).where(eq(technicianServicePricingTable.technicianId, profile.id));
      if (parsed.data.services.length) {
        await tx.insert(technicianSkillsTable).values(parsed.data.services.map(({ categorySlug }) => ({
          technicianId: profile.id,
          categoryId: categoryBySlug.get(categorySlug)!,
        })));
        await tx.insert(technicianServicePricingTable).values(parsed.data.services.map((service) => ({
          technicianId: profile.id,
          categoryId: categoryBySlug.get(service.categorySlug)!,
          pricingModel: service.pricingModel,
          amount: service.amount === null ? null : String(service.amount),
          minimumCharge: service.minimumCharge == null ? null : String(service.minimumCharge),
        })));
      }
      return tx.select({
        categorySlug: serviceCategoriesTable.slug,
        categoryName: serviceCategoriesTable.name,
        pricingModel: technicianServicePricingTable.pricingModel,
        amount: technicianServicePricingTable.amount,
        minimumCharge: technicianServicePricingTable.minimumCharge,
      }).from(technicianServicePricingTable)
        .innerJoin(serviceCategoriesTable, eq(technicianServicePricingTable.categoryId, serviceCategoriesTable.id))
        .where(eq(technicianServicePricingTable.technicianId, profile.id));
    });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

router.get("/provider/availability", requireRole("PROVIDER"), async (req, res, next) => {
  try {
    const [profile] = await db.select({ id: technicianProfilesTable.id })
      .from(technicianProfilesTable)
      .where(eq(technicianProfilesTable.userId, currentUser(req)!.id))
      .limit(1);
    if (!profile) return res.status(404).json({ error: "Provider profile not found." });
    return res.json(await db.select().from(providerAvailabilityTable)
      .where(eq(providerAvailabilityTable.technicianId, profile.id)));
  } catch (error) {
    return next(error);
  }
});

router.put("/provider/availability", requireRole("PROVIDER"), async (req, res, next) => {
  const parsed = z.object({ availability: availabilityInput }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Provide valid weekly availability." });
  const slots = parsed.data.availability;
  for (let index = 0; index < slots.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < slots.length; otherIndex += 1) {
      const current = slots[index];
      const other = slots[otherIndex];
      if (current.dayOfWeek === other.dayOfWeek
        && current.startsAt < other.endsAt
        && other.startsAt < current.endsAt) {
        return res.status(400).json({ error: "Availability periods on the same day cannot overlap." });
      }
    }
  }
  try {
    const [profile] = await db.select({ id: technicianProfilesTable.id })
      .from(technicianProfilesTable)
      .where(eq(technicianProfilesTable.userId, currentUser(req)!.id))
      .limit(1);
    if (!profile) return res.status(404).json({ error: "Provider profile not found." });
    const rows = await db.transaction(async (tx) => {
      await tx.delete(providerAvailabilityTable).where(eq(providerAvailabilityTable.technicianId, profile.id));
      if (!slots.length) return [];
      return tx.insert(providerAvailabilityTable).values(slots.map((slot) => ({
        technicianId: profile.id,
        ...slot,
      }))).returning();
    });
    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

router.get("/provider/requests", requireRole("PROVIDER"), async (req, res, next) => {
  try {
    const [profile] = await db.select({ id: technicianProfilesTable.id, verificationStatus: technicianProfilesTable.verificationStatus })
      .from(technicianProfilesTable)
      .where(eq(technicianProfilesTable.userId, currentUser(req)!.id))
      .limit(1);
    if (!profile) return res.status(404).json({ error: "Provider profile not found." });
    if (profile.verificationStatus !== "VERIFIED") return res.json([]);

    const requests = await db.select({
      request: serviceRequestsTable,
      serviceName: serviceCategoriesTable.name,
      serviceSlug: serviceCategoriesTable.slug,
      offer: providerOffersTable,
    }).from(technicianSkillsTable)
      .innerJoin(serviceRequestsTable, and(
        eq(serviceRequestsTable.categoryId, technicianSkillsTable.categoryId),
        inArray(serviceRequestsTable.status, ["REQUESTED", "SEARCHING"]),
      ))
      .innerJoin(serviceCategoriesTable, eq(serviceCategoriesTable.id, serviceRequestsTable.categoryId))
      .leftJoin(providerOffersTable, and(
        eq(providerOffersTable.requestId, serviceRequestsTable.id),
        eq(providerOffersTable.technicianId, profile.id),
      ))
      .where(and(
        eq(technicianSkillsTable.technicianId, profile.id),
        ne(serviceRequestsTable.customerId, currentUser(req)!.id),
        eq(providerOffersTable.status, "OFFERED"),
        gt(providerOffersTable.expiresAt, new Date()),
      ));

    return res.json(requests.map(({ request, serviceName, serviceSlug, offer }) => {
      const [problem] = request.problemDescription.split("\n");
      return {
        id: request.id,
        offerId: offer?.id ?? null,
        serviceName,
        serviceSlug,
        problem,
        description: request.problemDescription.slice(problem.length).trim(),
        preferredAt: request.preferredAt?.toISOString() ?? null,
        urgency: request.urgency,
        budgetMin: request.budgetMin === null ? null : Number(request.budgetMin),
        budgetMax: request.budgetMax === null ? null : Number(request.budgetMax),
        estimatedPriceMin: Number(request.estimatedPriceMin),
        estimatedPriceMax: Number(request.estimatedPriceMax),
        locationAvailable: request.latitude !== null && request.longitude !== null,
        createdAt: request.createdAt.toISOString(),
      };
    }));
  } catch (error) {
    return next(error);
  }
});

router.post("/provider/requests/:id/respond", requireRole("PROVIDER"), async (req, res, next) => {
  const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
  const body = z.object({
    decision: z.enum(["ACCEPT", "DECLINE"]),
    quotedPrice: z.number().positive().optional(),
    message: z.string().trim().max(1000).optional(),
  }).safeParse(req.body);
  if (!params.success || !body.success) return res.status(400).json({ error: "Provide a valid request response." });
  try {
    const [profile] = await db.select().from(technicianProfilesTable)
      .where(eq(technicianProfilesTable.userId, currentUser(req)!.id))
      .limit(1);
    if (!profile || profile.verificationStatus !== "VERIFIED" || !profile.isAvailable) {
      return res.status(403).json({ error: "A verified, available provider profile is required." });
    }
    const result = await db.transaction(async (tx) => {
      const [request] = await tx.select().from(serviceRequestsTable)
        .where(eq(serviceRequestsTable.id, params.data.id))
        .limit(1)
        .for("update");
      if (!request || !["REQUESTED", "SEARCHING"].includes(request.status)) return undefined;
      const [skill] = await tx.select({ id: technicianSkillsTable.categoryId }).from(technicianSkillsTable)
        .where(and(eq(technicianSkillsTable.technicianId, profile.id), eq(technicianSkillsTable.categoryId, request.categoryId)))
        .limit(1);
      if (!skill) return undefined;
      const [existingOffer] = await tx.select().from(providerOffersTable)
        .where(and(eq(providerOffersTable.requestId, request.id), eq(providerOffersTable.technicianId, profile.id)))
        .limit(1)
        .for("update");
      if (!existingOffer || existingOffer.status !== "OFFERED" || existingOffer.expiresAt <= new Date()) return undefined;
      if (body.data.decision === "DECLINE") {
        const [offer] = await tx.update(providerOffersTable).set({
          status: "DECLINED",
          message: body.data.message,
          respondedAt: new Date(),
        }).where(eq(providerOffersTable.id, existingOffer.id)).returning();
        return offer ? { decision: "DECLINED", offerId: offer.id } : undefined;
      }
      const [pricing] = await tx.select({
        pricingModel: technicianServicePricingTable.pricingModel,
        amount: technicianServicePricingTable.amount,
        minimumCharge: technicianServicePricingTable.minimumCharge,
      }).from(technicianServicePricingTable).where(and(
        eq(technicianServicePricingTable.technicianId, profile.id),
        eq(technicianServicePricingTable.categoryId, request.categoryId),
      )).limit(1);
      const resolvedPrice = resolveProviderPrice(pricing, body.data.quotedPrice);
      if ("error" in resolvedPrice) return { kind: "invalid-price" as const, error: resolvedPrice.error };
      if (request.budgetMax !== null && resolvedPrice.price > Number(request.budgetMax)) return { kind: "over-budget" as const };
      if (request.isEmergency && (
        !profile.emergencyEligible
        || profile.currentLatitude === null
        || profile.currentLongitude === null
        || !profile.locationUpdatedAt
        || Date.now() - profile.locationUpdatedAt.getTime() > 5 * 60 * 1000
      )) return { kind: "ineligible-emergency" as const };
      const [offer] = await tx.update(providerOffersTable).set({
        status: "ACCEPTED",
        quotedPrice: String(resolvedPrice.price),
        message: body.data.message,
        respondedAt: new Date(),
      }).where(eq(providerOffersTable.id, existingOffer.id)).returning();
      if (!offer) return undefined;
      const [booking] = await tx.insert(bookingsTable).values({
        requestId: request.id,
        customerId: request.customerId,
        technicianId: profile.id,
        status: "ACCEPTED",
        finalPrice: String(resolvedPrice.price),
      }).returning();
      if (!booking) throw new Error("Could not create the provider booking.");
      await tx.update(serviceRequestsTable).set({
        technicianId: profile.id,
        status: "ACCEPTED",
        finalPrice: String(resolvedPrice.price),
        updatedAt: new Date(),
      }).where(eq(serviceRequestsTable.id, request.id));
      await tx.insert(bookingStatusHistoryTable).values({
        bookingId: booking.id,
        status: "ACCEPTED",
        changedBy: currentUser(req)!.id,
      });
      await tx.update(providerOffersTable).set({ status: "WITHDRAWN", respondedAt: new Date() })
        .where(and(eq(providerOffersTable.requestId, request.id), ne(providerOffersTable.technicianId, profile.id), eq(providerOffersTable.status, "OFFERED")));
      await tx.insert(conversationsTable).values({ bookingId: booking.id });
      await tx.update(emergencyRequestsTable).set({ status: "ACCEPTED" })
        .where(eq(emergencyRequestsTable.requestId, request.id));
      await tx.insert(notificationsTable).values({
        userId: request.customerId,
        type: "BOOKING_ACCEPTED",
        title: "A provider accepted your request",
        body: "Your provider has accepted and will confirm the next details.",
        payload: { bookingId: booking.id, requestId: request.id },
      });
      return { decision: "ACCEPTED", bookingId: booking.id, offerId: offer.id };
    });
    if (result && "kind" in result && result.kind === "invalid-price") return res.status(409).json({ error: result.error });
    if (result && "kind" in result && result.kind === "over-budget") return res.status(409).json({ error: "The provider's price exceeds the customer's budget." });
    if (result && "kind" in result && result.kind === "ineligible-emergency") return res.status(409).json({ error: "The provider no longer meets emergency dispatch requirements." });
    return result ? res.json(result) : res.status(409).json({ error: "This request is no longer available or has already been answered." });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      return res.status(409).json({ error: "Another provider has already accepted this request." });
    }
    return next(error);
  }
});

router.get("/provider/bookings", requireRole("PROVIDER"), async (req, res, next) => {
  try {
    const [profile] = await db.select({ id: technicianProfilesTable.id })
      .from(technicianProfilesTable)
      .where(eq(technicianProfilesTable.userId, currentUser(req)!.id))
      .limit(1);
    if (!profile) return res.status(404).json({ error: "Provider profile not found." });
    const jobs = await db.select({
      booking: bookingsTable,
      request: serviceRequestsTable,
      serviceName: serviceCategoriesTable.name,
    }).from(bookingsTable)
      .innerJoin(serviceRequestsTable, eq(bookingsTable.requestId, serviceRequestsTable.id))
      .innerJoin(serviceCategoriesTable, eq(serviceCategoriesTable.id, serviceRequestsTable.categoryId))
      .where(eq(bookingsTable.technicianId, profile.id));
    return res.json(jobs.map(({ booking, request, serviceName }) => ({
      id: booking.id,
      requestId: request.id,
      serviceName,
      problem: request.problemDescription.split("\n", 1)[0],
      address: request.address,
      status: booking.status,
      finalPrice: booking.finalPrice === null ? null : Number(booking.finalPrice),
      preferredAt: request.preferredAt?.toISOString() ?? null,
      createdAt: booking.createdAt.toISOString(),
    })));
  } catch (error) {
    return next(error);
  }
});

export default router;
