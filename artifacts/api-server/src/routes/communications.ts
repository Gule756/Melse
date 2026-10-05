import { Router, type IRouter } from "express";
import { and, desc, eq, isNull, lt, ne, or } from "drizzle-orm";
import { z } from "zod";
import {
  bookingsTable,
  conversationsTable,
  db,
  messagesTable,
  notificationsTable,
  serviceCategoriesTable,
  serviceRequestsTable,
  technicianProfilesTable,
} from "@workspace/db";
import { currentUser, requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

async function bookingParticipation(userId: string, bookingId: string) {
  const [provider] = await db.select({ id: technicianProfilesTable.id })
    .from(technicianProfilesTable)
    .where(eq(technicianProfilesTable.userId, userId))
    .limit(1);
  const conditions = [eq(bookingsTable.customerId, userId)];
  if (provider) conditions.push(eq(bookingsTable.technicianId, provider.id));
  return db.select({ booking: bookingsTable })
    .from(bookingsTable)
    .where(and(eq(bookingsTable.id, bookingId), or(...conditions)))
    .limit(1);
}

router.get("/conversations", requireAuth, async (req, res, next) => {
  try {
    const user = currentUser(req)!;
    const [provider] = await db.select({ id: technicianProfilesTable.id })
      .from(technicianProfilesTable)
      .where(eq(technicianProfilesTable.userId, user.id))
      .limit(1);
    const conditions = [eq(bookingsTable.customerId, user.id)];
    if (provider) conditions.push(eq(bookingsTable.technicianId, provider.id));
    const rows = await db.select({
      booking: bookingsTable,
      conversation: conversationsTable,
      serviceName: serviceCategoriesTable.name,
    }).from(bookingsTable)
      .innerJoin(serviceRequestsTable, eq(bookingsTable.requestId, serviceRequestsTable.id))
      .innerJoin(serviceCategoriesTable, eq(serviceRequestsTable.categoryId, serviceCategoriesTable.id))
      .leftJoin(conversationsTable, eq(conversationsTable.bookingId, bookingsTable.id))
      .where(or(...conditions))
      .orderBy(desc(bookingsTable.updatedAt))
      .limit(100);
    return res.json(rows.map(({ booking, conversation, serviceName }) => ({
      bookingId: booking.id,
      conversationId: conversation?.id ?? null,
      serviceName,
      status: booking.status,
      updatedAt: booking.updatedAt.toISOString(),
      lastMessageAt: conversation?.lastMessageAt?.toISOString() ?? null,
    })));
  } catch (error) {
    return next(error);
  }
});

router.get("/conversations/:id/messages", requireAuth, async (req, res, next) => {
  const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
  const query = z.object({
    before: z.string().datetime().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }).safeParse(req.query);
  if (!params.success || !query.success) return res.status(400).json({ error: "Invalid conversation query." });
  try {
    const [conversation] = await db.select({ bookingId: conversationsTable.bookingId })
      .from(conversationsTable).where(eq(conversationsTable.id, params.data.id)).limit(1);
    if (!conversation) return res.status(404).json({ error: "Conversation not found." });
    const [booking] = await bookingParticipation(currentUser(req)!.id, conversation.bookingId);
    if (!booking) return res.status(404).json({ error: "Conversation not found." });
    const filters = [eq(messagesTable.conversationId, params.data.id)];
    if (query.data.before) filters.push(lt(messagesTable.createdAt, new Date(query.data.before)));
    const rows = await db.select().from(messagesTable)
      .where(and(...filters))
      .orderBy(desc(messagesTable.createdAt))
      .limit(query.data.limit);
    await db.update(messagesTable).set({ readAt: new Date() })
      .where(and(
        eq(messagesTable.conversationId, params.data.id),
        ne(messagesTable.senderId, currentUser(req)!.id),
        isNull(messagesTable.readAt),
      ));
    return res.json(rows.reverse().map((message) => ({ ...message, createdAt: message.createdAt.toISOString(), readAt: message.readAt?.toISOString() ?? null })));
  } catch (error) {
    return next(error);
  }
});

router.post("/conversations/:id/messages", requireAuth, async (req, res, next) => {
  const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
  const body = z.object({
    body: z.string().trim().max(4000).default(""),
    attachmentUrl: z.string().url().refine((url) => url.startsWith("https://"), "Attachment must use HTTPS.").optional(),
  }).refine((message) => message.body.length > 0 || message.attachmentUrl !== undefined).safeParse(req.body);
  if (!params.success || !body.success) return res.status(400).json({ error: "Send a message or a secure attachment." });
  try {
    const sender = currentUser(req)!;
    const result = await db.transaction(async (tx) => {
      const [conversation] = await tx.select().from(conversationsTable)
        .where(eq(conversationsTable.id, params.data.id)).limit(1).for("update");
      if (!conversation) return { kind: "not-found" as const };
      const [booking] = await tx.select().from(bookingsTable)
        .where(eq(bookingsTable.id, conversation.bookingId)).limit(1);
      if (!booking) return { kind: "not-found" as const };
      const [provider] = await tx.select({ id: technicianProfilesTable.id, userId: technicianProfilesTable.userId })
        .from(technicianProfilesTable).where(eq(technicianProfilesTable.id, booking.technicianId)).limit(1);
      if (sender.id !== booking.customerId && sender.id !== provider?.userId) return { kind: "forbidden" as const };
      if (["CANCELLED", "REFUNDED"].includes(booking.status)) return { kind: "closed" as const };
      const [message] = await tx.insert(messagesTable).values({
        conversationId: conversation.id,
        senderId: sender.id,
        body: body.data.body,
        attachmentUrl: body.data.attachmentUrl,
      }).returning();
      if (!message) throw new Error("Message was not persisted.");
      await tx.update(conversationsTable).set({ lastMessageAt: message.createdAt })
        .where(eq(conversationsTable.id, conversation.id));
      const recipientId = sender.id === booking.customerId ? provider?.userId : booking.customerId;
      if (recipientId) {
        await tx.insert(notificationsTable).values({
          userId: recipientId,
          type: "MESSAGE",
          title: "New booking message",
          body: "You have a new message about a service booking.",
          payload: { bookingId: booking.id, conversationId: conversation.id, messageId: message.id },
        });
      }
      return { kind: "created" as const, message };
    });
    if (result.kind === "not-found") return res.status(404).json({ error: "Conversation not found." });
    if (result.kind === "forbidden") return res.status(403).json({ error: "You are not part of this booking." });
    if (result.kind === "closed") return res.status(409).json({ error: "This booking conversation is closed." });
    return res.status(201).json({ ...result.message, createdAt: result.message.createdAt.toISOString() });
  } catch (error) {
    return next(error);
  }
});

router.get("/notifications", requireAuth, async (req, res, next) => {
  try {
    const rows = await db.select().from(notificationsTable)
      .where(eq(notificationsTable.userId, currentUser(req)!.id))
      .orderBy(desc(notificationsTable.createdAt))
      .limit(100);
    return res.json(rows.map((notification) => ({
      ...notification,
      createdAt: notification.createdAt.toISOString(),
      readAt: notification.readAt?.toISOString() ?? null,
    })));
  } catch (error) {
    return next(error);
  }
});

router.patch("/notifications/:id/read", requireAuth, async (req, res, next) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) return res.status(404).json({ error: "Notification not found." });
  try {
    const [notification] = await db.update(notificationsTable).set({ readAt: new Date() })
      .where(and(eq(notificationsTable.id, id.data), eq(notificationsTable.userId, currentUser(req)!.id)))
      .returning();
    return notification ? res.json({ id: notification.id, readAt: notification.readAt?.toISOString() }) : res.status(404).json({ error: "Notification not found." });
  } catch (error) {
    return next(error);
  }
});

export default router;
