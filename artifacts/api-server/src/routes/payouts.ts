import { Router, type IRouter } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import {
  auditLogsTable,
  db,
  disputesTable,
  ledgerEntriesTable,
  providerPayoutsTable,
  technicianProfilesTable,
  usersTable,
} from "@workspace/db";
import { currentUser, requireRole } from "../middlewares/auth";

const router: IRouter = Router();
const activeDisputeStatuses = ["OPEN", "UNDER_REVIEW"] as const;
const providerUsersTable = alias(usersTable, "payout_provider");

function availableBalance(
  earned: Array<{ bookingId: string; amount: string }>,
  disputed: Array<{ bookingId: string }>,
  payouts: Array<{ amount: string; status: string }>,
) {
  const heldBookings = new Set(disputed.map(({ bookingId }) => bookingId));
  const grossEligible = earned.reduce((sum, entry) => heldBookings.has(entry.bookingId) ? sum : sum + Number(entry.amount), 0);
  const committed = payouts.reduce((sum, payout) => ["PENDING", "PROCESSING", "COMPLETED"].includes(payout.status)
    ? sum + Number(payout.amount)
    : sum, 0);
  return { earned: grossEligible, committed, available: Math.max(0, grossEligible - committed) };
}

async function balancesForProvider(technicianId: string, userId: string) {
  const earned = await db.select({
    bookingId: ledgerEntriesTable.bookingId,
    amount: ledgerEntriesTable.amount,
  }).from(ledgerEntriesTable)
    .where(and(
      eq(ledgerEntriesTable.userId, userId),
      eq(ledgerEntriesTable.type, "PROVIDER_EARNING"),
    ));
  const disputed = await db.select({ bookingId: disputesTable.bookingId }).from(disputesTable)
    .where(inArray(disputesTable.status, [...activeDisputeStatuses]));
  const payouts = await db.select({ amount: providerPayoutsTable.amount, status: providerPayoutsTable.status })
    .from(providerPayoutsTable).where(eq(providerPayoutsTable.technicianId, technicianId));
  return { ...availableBalance(earned, disputed, payouts), payouts };
}

router.get("/provider/payouts", requireRole("PROVIDER"), async (req, res, next) => {
  try {
    const [profile] = await db.select({ id: technicianProfilesTable.id })
      .from(technicianProfilesTable).where(eq(technicianProfilesTable.userId, currentUser(req)!.id)).limit(1);
    if (!profile) return res.status(404).json({ error: "Provider profile not found." });
    const [balance, payouts] = await Promise.all([
      balancesForProvider(profile.id, currentUser(req)!.id),
      db.select().from(providerPayoutsTable).where(eq(providerPayoutsTable.technicianId, profile.id))
        .orderBy(desc(providerPayoutsTable.requestedAt)),
    ]);
    return res.json({
      currency: "ETB",
      earned: Number(balance.earned.toFixed(2)),
      committed: Number(balance.committed.toFixed(2)),
      available: Number(balance.available.toFixed(2)),
      payoutProcessing: "Manual bank transfer processing; no automated payout provider is configured.",
      payouts,
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/provider/payouts", requireRole("PROVIDER"), async (req, res, next) => {
  const body = z.object({ amount: z.number().positive().max(10_000_000).multipleOf(0.01) }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Enter a positive payout amount." });
  const requestKey = z.string().trim().min(8).max(120).safeParse(req.get("idempotency-key"));
  if (!requestKey.success) return res.status(400).json({ error: "An Idempotency-Key header is required for payout requests." });
  try {
    const [profile] = await db.select({ id: technicianProfilesTable.id, verificationStatus: technicianProfilesTable.verificationStatus })
      .from(technicianProfilesTable).where(eq(technicianProfilesTable.userId, currentUser(req)!.id)).limit(1);
    if (!profile) return res.status(404).json({ error: "Provider profile not found." });
    if (profile.verificationStatus !== "VERIFIED") return res.status(403).json({ error: "Only verified providers may request payouts." });
    const result = await db.transaction(async (tx) => {
      const [lockedProfile] = await tx.select({ id: technicianProfilesTable.id })
        .from(technicianProfilesTable).where(eq(technicianProfilesTable.id, profile.id)).limit(1).for("update");
      if (!lockedProfile) return undefined;
      const idempotencyKey = `payout:${profile.id}:${requestKey.data}`;
      const [existing] = await tx.select().from(providerPayoutsTable)
        .where(eq(providerPayoutsTable.idempotencyKey, idempotencyKey)).limit(1);
      if (existing) return Number(existing.amount) === body.data.amount
        ? { existing } as const
        : { idempotencyConflict: true as const };
      const earned = await tx.select({
        bookingId: ledgerEntriesTable.bookingId,
        amount: ledgerEntriesTable.amount,
      }).from(ledgerEntriesTable).where(and(
        eq(ledgerEntriesTable.userId, currentUser(req)!.id),
        eq(ledgerEntriesTable.type, "PROVIDER_EARNING"),
      ));
      const disputed = await tx.select({ bookingId: disputesTable.bookingId }).from(disputesTable)
        .where(inArray(disputesTable.status, [...activeDisputeStatuses]));
      const payouts = await tx.select({ amount: providerPayoutsTable.amount, status: providerPayoutsTable.status })
        .from(providerPayoutsTable).where(eq(providerPayoutsTable.technicianId, profile.id));
      const balance = availableBalance(earned, disputed, payouts);
      if (body.data.amount > balance.available + 0.001) return { insufficient: true as const };
      const [payout] = await tx.insert(providerPayoutsTable).values({
        technicianId: profile.id,
        amount: body.data.amount.toFixed(2),
        status: "PENDING",
        idempotencyKey,
      }).returning();
      return { payout } as const;
    });
    if (!result) return res.status(404).json({ error: "Provider profile not found." });
    if ("insufficient" in result) return res.status(409).json({ error: "Requested amount exceeds your available balance after dispute holds." });
    if ("idempotencyConflict" in result) return res.status(409).json({ error: "This Idempotency-Key was already used for a different payout amount." });
    if ("existing" in result) return res.status(200).json(result.existing);
    return result.payout ? res.status(201).json(result.payout) : res.status(500).json({ error: "Could not create payout request." });
  } catch (error) {
    return next(error);
  }
});

router.get("/admin/payouts", requireRole("ADMIN"), async (_req, res, next) => {
  try {
    const rows = await db.select({
      payout: providerPayoutsTable,
      providerName: providerUsersTable.fullName,
      phoneNumber: providerUsersTable.phoneNumber,
    }).from(providerPayoutsTable)
      .innerJoin(technicianProfilesTable, eq(providerPayoutsTable.technicianId, technicianProfilesTable.id))
      .innerJoin(providerUsersTable, eq(providerUsersTable.id, technicianProfilesTable.userId))
      .where(inArray(providerPayoutsTable.status, ["PENDING", "PROCESSING"]))
      .orderBy(providerPayoutsTable.requestedAt);
    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

router.patch("/admin/payouts/:id", requireRole("ADMIN"), async (req, res, next) => {
  const id = z.string().uuid().safeParse(req.params.id);
  const body = z.object({
    decision: z.enum(["COMPLETE", "REJECT"]),
    transferReference: z.string().trim().min(3).max(120).optional(),
    proofUrl: z.string().url().refine((url) => url.startsWith("https://"), "Transfer proof must use HTTPS.").optional(),
    note: z.string().trim().min(5).max(1000),
  }).refine((value) => value.decision !== "COMPLETE" || (value.transferReference !== undefined && value.proofUrl !== undefined), {
    message: "Record the external bank transfer reference and proof before completing the payout.",
  }).safeParse(req.body);
  if (!id.success || !body.success) return res.status(400).json({ error: "Provide a transfer reference and payout decision." });
  try {
    const result = await db.transaction(async (tx) => {
      const [payout] = await tx.select().from(providerPayoutsTable)
        .where(eq(providerPayoutsTable.id, id.data)).limit(1).for("update");
      if (!payout) return { kind: "not-found" as const };
      if (!["PENDING", "PROCESSING"].includes(payout.status)) return { kind: "conflict" as const };
      const [updated] = await tx.update(providerPayoutsTable).set({
        status: body.data.decision === "COMPLETE" ? "COMPLETED" : "REJECTED",
        providerReference: body.data.transferReference ?? null,
        proofUrl: body.data.proofUrl ?? null,
        processedAt: new Date(),
      }).where(eq(providerPayoutsTable.id, payout.id)).returning();
      await tx.insert(auditLogsTable).values({
        actorId: currentUser(req)!.id,
        action: body.data.decision === "COMPLETE" ? "PAYOUT_MANUALLY_COMPLETED" : "PAYOUT_REJECTED",
        entityType: "payout",
        entityId: payout.id,
        metadata: { note: body.data.note, transferReference: body.data.transferReference ?? null, proofUrl: body.data.proofUrl ?? null, amount: payout.amount },
      });
      return { kind: "updated" as const, payout: updated };
    });
    if (result.kind === "not-found") return res.status(404).json({ error: "Payout not found." });
    if (result.kind === "conflict") return res.status(409).json({ error: "This payout has already been processed." });
    return res.json(result.payout);
  } catch (error) {
    return next(error);
  }
});

export default router;
