import { Router, type IRouter } from "express";
import { createHash } from "node:crypto";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  emergencyRequestsTable,
  pricingRulesTable,
  providerOffersTable,
  serviceCategoriesTable,
  serviceRequestsTable,
  technicianProfilesTable,
  technicianSkillsTable,
  usersTable,
  bookingsTable,
} from "@workspace/db";
import { currentUser, requireAuth, requireRole } from "../middlewares/auth";
import { calculateEstimate } from "../lib/pricing";

const router: IRouter = Router();
const safetyNotice = "If anyone is in immediate danger, there is a fire, serious injury, or risk to life, contact the appropriate local emergency authorities first. Melse is not an emergency service.";

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const latDelta = toRadians(lat2 - lat1);
  const lonDelta = toRadians(lon2 - lon1);
  const haversine = Math.sin(latDelta / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(lonDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

router.post("/emergency/requests", requireRole("CUSTOMER"), async (req, res, next) => {
  const body = z.object({
    serviceSlug: z.string().trim().min(1).max(50),
    emergencyType: z.enum(["LOCKSMITH", "PLUMBING", "ELECTRICAL", "ROADSIDE", "OTHER"]),
    problem: z.string().trim().min(2).max(200),
    description: z.string().trim().min(5).max(3000),
    address: z.string().trim().min(4).max(1000),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    safetyAcknowledged: z.literal(true),
  }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Complete the emergency request and confirm the safety notice.", safetyNotice });
  const idempotencyKey = z.string().trim().min(8).max(120).safeParse(req.get("idempotency-key"));
  if (!idempotencyKey.success) return res.status(400).json({ error: "An Idempotency-Key header is required.", safetyNotice });
  const payloadHash = createHash("sha256").update(JSON.stringify(body.data)).digest("hex");
  try {
    const [existing] = await db.select().from(serviceRequestsTable)
      .where(eq(serviceRequestsTable.idempotencyKey, idempotencyKey.data)).limit(1);
    if (existing) {
      if (existing.customerId !== currentUser(req)!.id || existing.payloadHash !== payloadHash || !existing.isEmergency) {
        return res.status(409).json({ error: "Idempotency key was already used for a different request.", safetyNotice });
      }
      const [emergency] = await db.select().from(emergencyRequestsTable)
        .where(eq(emergencyRequestsTable.requestId, existing.id)).limit(1);
      return res.status(200).json({
        requestId: existing.id,
        status: emergency?.status ?? existing.status,
        nearestProviderDistanceKm: null,
        estimate: { min: Number(existing.estimatedPriceMin), max: Number(existing.estimatedPriceMax), currency: "ETB" },
        safetyNotice,
      });
    }
    const [category] = await db.select().from(serviceCategoriesTable)
      .where(and(eq(serviceCategoriesTable.slug, body.data.serviceSlug), eq(serviceCategoriesTable.isActive, true)))
      .limit(1);
    if (!category) return res.status(400).json({ error: "That emergency service is not available.", safetyNotice });
    const [pricing] = await db.select().from(pricingRulesTable)
      .where(eq(pricingRulesTable.categoryId, category.id)).limit(1);
    if (!pricing) return res.status(503).json({ error: "Emergency pricing is not configured.", safetyNotice });
    const skillful = await db.select({ profile: technicianProfilesTable })
      .from(technicianProfilesTable)
      .innerJoin(usersTable, eq(usersTable.id, technicianProfilesTable.userId))
      .innerJoin(technicianSkillsTable, eq(technicianSkillsTable.technicianId, technicianProfilesTable.id))
      .where(and(
        eq(technicianSkillsTable.categoryId, category.id),
        eq(technicianProfilesTable.emergencyEligible, true),
        eq(technicianProfilesTable.isAvailable, true),
        eq(technicianProfilesTable.verificationStatus, "VERIFIED"),
        eq(usersTable.isActive, true),
      ));
    const candidates = skillful.map(({ profile }) => {
      if (profile.currentLatitude === null || profile.currentLongitude === null || !profile.locationUpdatedAt) return undefined;
      if (Date.now() - profile.locationUpdatedAt.getTime() > 5 * 60 * 1000) return undefined;
      const distance = distanceKm(
        body.data.latitude,
        body.data.longitude,
        Number(profile.currentLatitude),
        Number(profile.currentLongitude),
      );
      if (distance > Number(profile.serviceRadiusKm)) return undefined;
      return { id: profile.id, distance };
    }).filter((candidate): candidate is { id: string; distance: number } => candidate !== undefined)
      .sort((left, right) => left.distance - right.distance);
    if (candidates.length === 0) {
      return res.status(503).json({
        error: "No eligible emergency provider with a current location is available nearby.",
        safetyNotice,
      });
    }

    const estimate = calculateEstimate({
      baseMin: Number(pricing.basePriceMin),
      baseMax: Number(pricing.basePriceMax),
      emergencyFee: Number(pricing.emergencyFee),
      commissionRate: Number(pricing.platformCommissionRate),
      customerFee: Number(pricing.customerFee),
      includedDistanceKm: Number(pricing.includedDistanceKm),
      perKmRate: Number(pricing.perKmRate),
    }, { isEmergency: true, distanceKm: candidates[0].distance });
    const created = await db.transaction(async (tx) => {
      const [request] = await tx.insert(serviceRequestsTable).values({
        customerId: currentUser(req)!.id,
        categoryId: category.id,
        idempotencyKey: idempotencyKey.data,
        payloadHash,
        status: "SEARCHING",
        problemDescription: `${body.data.problem}\n${body.data.description}`,
        address: body.data.address,
        latitude: String(body.data.latitude),
        longitude: String(body.data.longitude),
        estimatedPriceMin: String(estimate.minPrice),
        estimatedPriceMax: String(estimate.maxPrice),
        urgency: "EMERGENCY",
        isEmergency: true,
      }).returning();
      if (!request) throw new Error("Could not create emergency request.");
      await tx.insert(emergencyRequestsTable).values({
        requestId: request.id,
        emergencyType: body.data.emergencyType,
        safetyAcknowledgedAt: new Date(),
        status: "DISPATCHING",
      });
      await tx.insert(providerOffersTable).values({
        requestId: request.id,
        technicianId: candidates[0].id,
        status: "OFFERED",
        expiresAt: new Date(Date.now() + 60_000),
      });
      return request;
    });
    return res.status(201).json({
      requestId: created.id,
      status: "DISPATCHING",
      nearestProviderDistanceKm: Math.round(candidates[0].distance * 10) / 10,
      estimate: { min: estimate.minPrice, max: estimate.maxPrice, currency: "ETB" },
      safetyNotice,
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      const [existing] = await db.select().from(serviceRequestsTable)
        .where(eq(serviceRequestsTable.idempotencyKey, idempotencyKey.data)).limit(1);
      if (existing && existing.customerId === currentUser(req)!.id && existing.payloadHash === payloadHash && existing.isEmergency) {
        const [emergency] = await db.select().from(emergencyRequestsTable)
          .where(eq(emergencyRequestsTable.requestId, existing.id)).limit(1);
        return res.status(200).json({
          requestId: existing.id,
          status: emergency?.status ?? existing.status,
          nearestProviderDistanceKm: null,
          estimate: { min: Number(existing.estimatedPriceMin), max: Number(existing.estimatedPriceMax), currency: "ETB" },
          safetyNotice,
        });
      }
      return res.status(409).json({ error: "Idempotency key was already used for a different request.", safetyNotice });
    }
    return next(error);
  }
});

router.get("/emergency/requests/:id", requireAuth, async (req, res, next) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) return res.status(404).json({ error: "Emergency request not found." });
  try {
    const user = currentUser(req)!;
    const [row] = await db.select({
      request: serviceRequestsTable,
      emergency: emergencyRequestsTable,
      booking: bookingsTable,
    }).from(emergencyRequestsTable)
      .innerJoin(serviceRequestsTable, eq(emergencyRequestsTable.requestId, serviceRequestsTable.id))
      .leftJoin(bookingsTable, eq(bookingsTable.requestId, serviceRequestsTable.id))
      .where(eq(emergencyRequestsTable.requestId, id.data)).limit(1);
    if (!row) return res.status(404).json({ error: "Emergency request not found." });
    const [provider] = row.booking
      ? await db.select({ userId: technicianProfilesTable.userId, latitude: technicianProfilesTable.currentLatitude, longitude: technicianProfilesTable.currentLongitude, locationUpdatedAt: technicianProfilesTable.locationUpdatedAt })
        .from(technicianProfilesTable)
        .where(eq(technicianProfilesTable.id, row.booking.technicianId)).limit(1)
      : [];
    const isParticipant = row.request.customerId === user.id || provider?.userId === user.id;
    if (!isParticipant && !user.roles.includes("ADMIN")) return res.status(404).json({ error: "Emergency request not found." });
    return res.json({
      requestId: row.request.id,
      type: row.emergency.emergencyType,
      status: row.emergency.status,
      bookingStatus: row.booking?.status ?? null,
      location: row.request.address,
      tracking: row.booking && ["TECHNICIAN_EN_ROUTE", "ARRIVED", "IN_PROGRESS"].includes(row.booking.status)
        && provider && provider.locationUpdatedAt && Date.now() - provider.locationUpdatedAt.getTime() < 5 * 60 * 1000
        ? { latitude: Number(provider.latitude), longitude: Number(provider.longitude), updatedAt: provider.locationUpdatedAt.toISOString() }
        : null,
      safetyNotice,
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/provider/location", requireRole("PROVIDER"), async (req, res, next) => {
  const body = z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    sharingEnabled: z.literal(true),
  }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Enable location sharing and provide valid coordinates." });
  try {
    const [profile] = await db.select({
      id: technicianProfilesTable.id,
      verificationStatus: technicianProfilesTable.verificationStatus,
      isAvailable: technicianProfilesTable.isAvailable,
    }).from(technicianProfilesTable).where(eq(technicianProfilesTable.userId, currentUser(req)!.id)).limit(1);
    if (!profile) return res.status(404).json({ error: "Provider profile not found." });
    if (profile.verificationStatus !== "VERIFIED" || !profile.isAvailable) {
      return res.status(409).json({ error: "Only verified providers who are online can share their location." });
    }
    await db.update(technicianProfilesTable).set({
      currentLatitude: String(body.data.latitude),
      currentLongitude: String(body.data.longitude),
      locationUpdatedAt: new Date(),
    }).where(eq(technicianProfilesTable.id, profile.id));
    return res.json({ updated: true, sharing: true });
  } catch (error) {
    return next(error);
  }
});

router.delete("/provider/location", requireRole("PROVIDER"), async (req, res, next) => {
  try {
    await db.update(technicianProfilesTable).set({
      currentLatitude: null,
      currentLongitude: null,
      locationUpdatedAt: null,
    }).where(eq(technicianProfilesTable.userId, currentUser(req)!.id));
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

router.get("/admin/emergency/requests", requireRole("ADMIN"), async (_req, res, next) => {
  try {
    const rows = await db.select({
      emergency: emergencyRequestsTable,
      requestId: serviceRequestsTable.id,
      status: serviceRequestsTable.status,
      customerId: serviceRequestsTable.customerId,
      address: serviceRequestsTable.address,
      createdAt: serviceRequestsTable.createdAt,
    }).from(emergencyRequestsTable)
      .innerJoin(serviceRequestsTable, eq(emergencyRequestsTable.requestId, serviceRequestsTable.id))
      .where(ne(emergencyRequestsTable.status, "COMPLETED"))
      .orderBy(sql`${emergencyRequestsTable.createdAt} DESC`);
    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

export default router;
