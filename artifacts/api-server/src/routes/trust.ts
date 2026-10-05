import { Router, type IRouter } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import {
  auditLogsTable,
  bookingStatusHistoryTable,
  bookingsTable,
  db,
  disputesTable,
  disputeEvidenceTable,
  reviewsTable,
  serviceRequestsTable,
  technicianProfilesTable,
  usersTable,
} from "@workspace/db";
import { currentUser, requireAuth, requireRole } from "../middlewares/auth";
import { canTransition } from "../lib/job-state";

const router: IRouter = Router();
const providerUsersTable = alias(usersTable, "provider_users");

router.get("/providers/:id/reviews", async (req, res, next) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) return res.status(404).json({ error: "Provider not found." });
  try {
    const [profile] = await db.select({ id: technicianProfilesTable.id })
      .from(technicianProfilesTable)
      .where(eq(technicianProfilesTable.id, id.data))
      .limit(1);
    if (!profile) return res.status(404).json({ error: "Provider not found." });
    const reviews = await db.select({
      id: reviewsTable.id,
      rating: reviewsTable.rating,
      comment: reviewsTable.comment,
      createdAt: reviewsTable.createdAt,
      customerName: usersTable.fullName,
    }).from(reviewsTable)
      .innerJoin(usersTable, eq(reviewsTable.customerId, usersTable.id))
      .where(eq(reviewsTable.technicianId, profile.id))
      .orderBy(desc(reviewsTable.createdAt))
      .limit(100);
    return res.json(reviews.map((review) => ({ ...review, createdAt: review.createdAt.toISOString() })));
  } catch (error) {
    return next(error);
  }
});

router.post("/bookings/:id/reviews", requireRole("CUSTOMER"), async (req, res, next) => {
  const id = z.string().uuid().safeParse(req.params.id);
  const body = z.object({
    rating: z.number().int().min(1).max(5),
    comment: z.string().trim().max(2000).optional(),
  }).safeParse(req.body);
  if (!id.success || !body.success) return res.status(400).json({ error: "Provide a rating from 1 to 5 and an optional comment." });
  try {
    const result = await db.transaction(async (tx) => {
      const [booking] = await tx.select().from(bookingsTable)
        .where(and(eq(bookingsTable.id, id.data), eq(bookingsTable.customerId, currentUser(req)!.id)))
        .limit(1).for("update");
      if (!booking) return { kind: "not-found" as const };
      if (!["COMPLETED", "CUSTOMER_CONFIRMED", "PAID"].includes(booking.status)) return { kind: "not-complete" as const };
      const [profile] = await tx.select().from(technicianProfilesTable)
        .where(eq(technicianProfilesTable.id, booking.technicianId)).limit(1).for("update");
      if (!profile) throw new Error("Booking provider profile is missing.");
      const [review] = await tx.insert(reviewsTable).values({
        bookingId: booking.id,
        customerId: booking.customerId,
        technicianId: booking.technicianId,
        rating: body.data.rating,
        comment: body.data.comment || null,
      }).onConflictDoNothing().returning();
      if (!review) return { kind: "duplicate" as const };
      const [aggregate] = await tx.select({
        average: sql<string>`avg(${reviewsTable.rating})`,
        count: sql<number>`count(*)`,
      }).from(reviewsTable).where(eq(reviewsTable.technicianId, profile.id));
      await tx.update(technicianProfilesTable).set({
        ratingAvg: Number(aggregate.average).toFixed(2),
        ratingCount: Number(aggregate.count),
      }).where(eq(technicianProfilesTable.id, profile.id));
      if (booking.status === "PAID" && canTransition("PAID", "RATED")) {
        await tx.update(bookingsTable).set({ status: "RATED", updatedAt: new Date() }).where(eq(bookingsTable.id, booking.id));
        await tx.insert(bookingStatusHistoryTable).values({ bookingId: booking.id, status: "RATED", changedBy: booking.customerId });
      }
      await tx.insert(auditLogsTable).values({
        actorId: booking.customerId,
        action: "REVIEW_CREATED",
        entityType: "review",
        entityId: review.id,
        metadata: { bookingId: booking.id, technicianId: booking.technicianId, rating: body.data.rating },
      });
      return { kind: "created" as const, review };
    });
    if (result.kind === "not-found") return res.status(404).json({ error: "Booking not found." });
    if (result.kind === "not-complete") return res.status(409).json({ error: "A review is available after the job is complete." });
    if (result.kind === "duplicate") return res.status(409).json({ error: "This booking already has a review." });
    return res.status(201).json(result.review);
  } catch (error) {
    return next(error);
  }
});

router.post("/bookings/:id/disputes", requireAuth, async (req, res, next) => {
  const id = z.string().uuid().safeParse(req.params.id);
  const body = z.object({
    reason: z.enum(["QUALITY", "NO_SHOW", "SAFETY", "PRICE", "DAMAGE", "OTHER"]),
    description: z.string().trim().min(10).max(5000),
    evidenceUrls: z.array(z.string().url().refine((url) => url.startsWith("https://"), "Evidence must use HTTPS.")).max(10).default([]),
  }).safeParse(req.body);
  if (!id.success || !body.success) return res.status(400).json({ error: "Provide a dispute reason and details." });
  try {
    const user = currentUser(req)!;
    const result = await db.transaction(async (tx) => {
      const [booking] = await tx.select().from(bookingsTable)
        .where(eq(bookingsTable.id, id.data)).limit(1).for("update");
      if (!booking) return { kind: "not-found" as const };
      const [provider] = await tx.select({ userId: technicianProfilesTable.userId })
        .from(technicianProfilesTable).where(eq(technicianProfilesTable.id, booking.technicianId)).limit(1);
      if (booking.customerId !== user.id && provider?.userId !== user.id && !user.roles.includes("ADMIN")) {
        return { kind: "forbidden" as const };
      }
      if (!["IN_PROGRESS", "COMPLETED", "CUSTOMER_CONFIRMED", "PAID", "RATED"].includes(booking.status)) {
        return { kind: "invalid-state" as const };
      }
      const [dispute] = await tx.insert(disputesTable).values({
        bookingId: booking.id,
        openedBy: user.id,
        reason: body.data.reason,
        description: body.data.description,
      }).onConflictDoNothing().returning();
      if (!dispute) return { kind: "duplicate" as const };
      for (const url of body.data.evidenceUrls) {
        await tx.insert(disputeEvidenceTable).values({ disputeId: dispute.id, submittedBy: user.id, url });
      }
      if (canTransition(booking.status, "DISPUTED")) {
        await tx.update(bookingsTable).set({ status: "DISPUTED", updatedAt: new Date() }).where(eq(bookingsTable.id, booking.id));
        await tx.insert(bookingStatusHistoryTable).values({ bookingId: booking.id, status: "DISPUTED", changedBy: user.id });
      }
      await tx.update(serviceRequestsTable).set({ status: "DISPUTED", updatedAt: new Date() })
        .where(eq(serviceRequestsTable.id, booking.requestId));
      await tx.insert(auditLogsTable).values({
        actorId: user.id,
        action: "DISPUTE_OPENED",
        entityType: "dispute",
        entityId: dispute.id,
        metadata: { bookingId: booking.id, reason: body.data.reason },
      });
      return { kind: "created" as const, dispute };
    });
    if (result.kind === "not-found") return res.status(404).json({ error: "Booking not found." });
    if (result.kind === "forbidden") return res.status(403).json({ error: "You are not part of this booking." });
    if (result.kind === "invalid-state") return res.status(409).json({ error: "A dispute cannot be opened in this booking state." });
    if (result.kind === "duplicate") return res.status(409).json({ error: "A dispute already exists for this booking." });
    return res.status(201).json(result.dispute);
  } catch (error) {
    return next(error);
  }
});

router.get("/admin/disputes", requireRole("ADMIN"), async (_req, res, next) => {
  try {
    const rows = await db.select({
      dispute: disputesTable,
      bookingStatus: bookingsTable.status,
      customerName: usersTable.fullName,
      providerName: providerUsersTable.fullName,
    }).from(disputesTable)
      .innerJoin(bookingsTable, eq(disputesTable.bookingId, bookingsTable.id))
      .innerJoin(usersTable, eq(bookingsTable.customerId, usersTable.id))
      .leftJoin(technicianProfilesTable, eq(bookingsTable.technicianId, technicianProfilesTable.id))
      .leftJoin(providerUsersTable, eq(technicianProfilesTable.userId, providerUsersTable.id))
      .where(sql`${disputesTable.status} NOT IN ('CLOSED', 'RESOLVED_CUSTOMER', 'RESOLVED_PROVIDER', 'PARTIALLY_REFUNDED')`)
      .orderBy(desc(disputesTable.createdAt));
    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

router.patch("/admin/disputes/:id", requireRole("ADMIN"), async (req, res, next) => {
  const id = z.string().uuid().safeParse(req.params.id);
  const body = z.object({
    status: z.enum(["UNDER_REVIEW", "RESOLVED_CUSTOMER", "RESOLVED_PROVIDER", "CLOSED"]),
    resolution: z.string().trim().min(10).max(5000),
  }).safeParse(req.body);
  if (!id.success || !body.success) return res.status(400).json({ error: "Provide a valid dispute decision and explanation." });
  try {
    const result = await db.transaction(async (tx) => {
      const [dispute] = await tx.select().from(disputesTable)
        .where(eq(disputesTable.id, id.data)).limit(1).for("update");
      if (!dispute) return undefined;
      if (["RESOLVED_CUSTOMER", "RESOLVED_PROVIDER", "PARTIALLY_REFUNDED", "CLOSED"].includes(dispute.status)) {
        return { conflict: true as const };
      }
      const [updated] = await tx.update(disputesTable).set({
        status: body.data.status,
        resolution: body.data.resolution,
        resolvedBy: body.data.status === "UNDER_REVIEW" ? null : currentUser(req)!.id,
        resolvedAt: body.data.status === "UNDER_REVIEW" ? null : new Date(),
        updatedAt: new Date(),
      }).where(eq(disputesTable.id, dispute.id)).returning();
      await tx.insert(auditLogsTable).values({
        actorId: currentUser(req)!.id,
        action: "DISPUTE_UPDATED",
        entityType: "dispute",
        entityId: dispute.id,
        metadata: { from: dispute.status, to: body.data.status },
      });
      return { dispute: updated };
    });
    if (!result) return res.status(404).json({ error: "Dispute not found." });
    if ("conflict" in result) return res.status(409).json({ error: "This dispute is already closed." });
    return res.json(result.dispute);
  } catch (error) {
    return next(error);
  }
});

export default router;
