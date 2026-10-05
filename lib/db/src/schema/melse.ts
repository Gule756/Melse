import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  decimal,
  integer,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const userRoleEnum = pgEnum("user_role", ["CUSTOMER", "PROVIDER", "ADMIN", "BUSINESS"]);
export const userModeEnum = pgEnum("user_mode", ["CUSTOMER", "PROVIDER", "ADMIN"]);
export const verificationStatusEnum = pgEnum("verification_status", ["PENDING", "UNDER_REVIEW", "VERIFIED", "SUSPENDED", "REJECTED"]);
export const jobStatusEnum = pgEnum("job_status", ["REQUESTED", "SEARCHING", "ASSIGNED", "ACCEPTED", "TECHNICIAN_EN_ROUTE", "ARRIVED", "IN_PROGRESS", "COMPLETED", "CUSTOMER_CONFIRMED", "PAID", "RATED", "CANCELLED", "DISPUTED", "REFUNDED", "REASSIGNED"]);
export const paymentStatusEnum = pgEnum("payment_status", ["PENDING", "PROCESSING", "COMPLETED", "FAILED", "REFUNDED"]);
export const providerPricingModelEnum = pgEnum("provider_pricing_model", ["FIXED", "HOURLY", "QUOTE"]);
export const providerOfferStatusEnum = pgEnum("provider_offer_status", ["OFFERED", "ACCEPTED", "DECLINED", "WITHDRAWN", "EXPIRED"]);
export const disputeStatusEnum = pgEnum("dispute_status", ["OPEN", "UNDER_REVIEW", "RESOLVED_CUSTOMER", "RESOLVED_PROVIDER", "PARTIALLY_REFUNDED", "CLOSED"]);
export const ledgerEntryTypeEnum = pgEnum("ledger_entry_type", ["CUSTOMER_PAYMENT", "PLATFORM_COMMISSION", "PROVIDER_EARNING", "REFUND", "PAYOUT"]);

export const usersTable = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  phoneNumber: varchar("phone_number", { length: 20 }).unique().notNull(),
  fullName: varchar("full_name", { length: 100 }).notNull(),
  passwordHash: text("password_hash").notNull(),
  role: userRoleEnum("role").default("CUSTOMER").notNull(),
  activeMode: userModeEnum("active_mode").default("CUSTOMER").notNull(),
  avatarUrl: text("avatar_url"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const businessAccountsTable = pgTable("business_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => usersTable.id, { onDelete: "cascade" }).unique().notNull(),
  businessName: varchar("business_name", { length: 150 }).notNull(),
  registrationNumber: varchar("registration_number", { length: 80 }),
  billingEmail: varchar("billing_email", { length: 180 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const homecarePlansTable = pgTable("homecare_plans", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description").notNull(),
  monthlyPrice: decimal("monthly_price", { precision: 10, scale: 2 }).notNull(),
  visitsPerMonth: integer("visits_per_month").default(1).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
});

export const homecareSubscriptionsTable = pgTable("homecare_subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  customerId: uuid("customer_id").references(() => usersTable.id, { onDelete: "cascade" }).notNull(),
  planId: uuid("plan_id").references(() => homecarePlansTable.id, { onDelete: "restrict" }).notNull(),
  status: varchar("status", { length: 20 }).default("ACTIVE").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  nextBillingAt: timestamp("next_billing_at", { withTimezone: true }).notNull(),
}, (table) => ({ customerStatusIndex: index("homecare_subscriptions_customer_status_idx").on(table.customerId, table.status) }));

export const promotionsTable = pgTable("promotions", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: varchar("code", { length: 40 }).unique().notNull(),
  description: text("description").notNull(),
  discountPercent: integer("discount_percent").notNull(),
  maxUses: integer("max_uses"),
  uses: integer("uses").default(0).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
});

export const loyaltyAccountsTable = pgTable("loyalty_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  customerId: uuid("customer_id").references(() => usersTable.id, { onDelete: "cascade" }).unique().notNull(),
  points: integer("points").default(0).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const loyaltyTransactionsTable = pgTable("loyalty_transactions", {
  id: uuid("id").defaultRandom().primaryKey(),
  accountId: uuid("account_id").references(() => loyaltyAccountsTable.id, { onDelete: "cascade" }).notNull(),
  points: integer("points").notNull(),
  reason: varchar("reason", { length: 120 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const customerAssetsTable = pgTable("customer_assets", {
  id: uuid("id").defaultRandom().primaryKey(),
  customerId: uuid("customer_id").references(() => usersTable.id, { onDelete: "cascade" }).notNull(),
  categoryId: uuid("category_id").references(() => serviceCategoriesTable.id, { onDelete: "restrict" }).notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  manufacturer: varchar("manufacturer", { length: 100 }),
  model: varchar("model", { length: 100 }),
  lastServicedAt: timestamp("last_serviced_at", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const maintenanceRecommendationsTable = pgTable("maintenance_recommendations", {
  id: uuid("id").defaultRandom().primaryKey(),
  assetId: uuid("asset_id").references(() => customerAssetsTable.id, { onDelete: "cascade" }).notNull(),
  title: varchar("title", { length: 160 }).notNull(),
  reason: text("reason").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  status: varchar("status", { length: 20 }).default("OPEN").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const userRolesTable = pgTable("user_roles", {
  userId: uuid("user_id").references(() => usersTable.id, { onDelete: "cascade" }).notNull(),
  role: userRoleEnum("role").notNull(),
}, (table) => ({
  userRoleUnique: uniqueIndex("user_roles_user_role_unique").on(table.userId, table.role),
}));

export const sessionsTable = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => usersTable.id, { onDelete: "cascade" }).notNull(),
  tokenHash: varchar("token_hash", { length: 128 }).unique().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  userExpiryIndex: index("sessions_user_expiry_idx").on(table.userId, table.expiresAt),
}));

export const passwordResetTokensTable = pgTable("password_reset_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => usersTable.id, { onDelete: "cascade" }).notNull(),
  tokenHash: varchar("token_hash", { length: 128 }).unique().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  userExpiryIndex: index("password_reset_tokens_user_expiry_idx").on(table.userId, table.expiresAt),
}));

export const serviceCategoriesTable = pgTable("service_categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 50 }).notNull(),
  slug: varchar("slug", { length: 50 }).unique().notNull(),
  iconName: varchar("icon_name", { length: 50 }).notNull(),
  description: text("description"),
  isActive: boolean("is_active").default(true).notNull(),
});

export const pricingRulesTable = pgTable("pricing_rules", {
  id: uuid("id").defaultRandom().primaryKey(),
  categoryId: uuid("category_id").references(() => serviceCategoriesTable.id, { onDelete: "cascade" }).notNull(),
  basePriceMin: decimal("base_price_min", { precision: 10, scale: 2 }).notNull(),
  basePriceMax: decimal("base_price_max", { precision: 10, scale: 2 }).notNull(),
  emergencyFee: decimal("emergency_fee", { precision: 10, scale: 2 }).default("0").notNull(),
  customerFee: decimal("customer_fee", { precision: 10, scale: 2 }).default("0").notNull(),
  includedDistanceKm: decimal("included_distance_km", { precision: 6, scale: 2 }).default("5").notNull(),
  perKmRate: decimal("per_km_rate", { precision: 10, scale: 2 }).default("30").notNull(),
  platformCommissionRate: decimal("platform_commission_rate", { precision: 5, scale: 4 }).default("0.15").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const technicianProfilesTable = pgTable("technician_profiles", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => usersTable.id, { onDelete: "cascade" }).unique().notNull(),
  verificationStatus: verificationStatusEnum("verification_status").default("PENDING").notNull(),
  idDocumentUrl: text("id_document_url"),
  experienceYears: integer("experience_years").default(0).notNull(),
  bio: text("bio"),
  hourlyRate: decimal("hourly_rate", { precision: 10, scale: 2 }),
  serviceArea: varchar("service_area", { length: 120 }),
  ratingAvg: decimal("rating_avg", { precision: 3, scale: 2 }).default("0").notNull(),
  ratingCount: integer("rating_count").default(0).notNull(),
  isAvailable: boolean("is_available").default(false).notNull(),
  currentLatitude: decimal("current_latitude", { precision: 10, scale: 8 }),
  currentLongitude: decimal("current_longitude", { precision: 11, scale: 8 }),
  locationUpdatedAt: timestamp("location_updated_at", { withTimezone: true }),
  serviceRadiusKm: decimal("service_radius_km", { precision: 6, scale: 2 }).default("15").notNull(),
  emergencyEligible: boolean("emergency_eligible").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  availabilityVerificationIndex: index("technician_profiles_verification_availability_idx").on(table.verificationStatus, table.isAvailable),
  experienceNonnegative: check("technician_profiles_experience_years_check", sql`${table.experienceYears} >= 0`),
  hourlyRateNonnegative: check("technician_profiles_hourly_rate_check", sql`${table.hourlyRate} IS NULL OR ${table.hourlyRate} >= 0`),
  serviceRadiusNonnegative: check("technician_profiles_service_radius_check", sql`${table.serviceRadiusKm} > 0`),
}));

export const technicianSkillsTable = pgTable("technician_skills", {
  technicianId: uuid("technician_id").references(() => technicianProfilesTable.id, { onDelete: "cascade" }).notNull(),
  categoryId: uuid("category_id").references(() => serviceCategoriesTable.id, { onDelete: "cascade" }).notNull(),
}, (table) => ({
  technicianCategoryUnique: uniqueIndex("technician_skills_technician_category_unique").on(table.technicianId, table.categoryId),
  categoryIndex: index("technician_skills_category_idx").on(table.categoryId),
}));

export const technicianServicePricingTable = pgTable("technician_service_pricing", {
  id: uuid("id").defaultRandom().primaryKey(),
  technicianId: uuid("technician_id").references(() => technicianProfilesTable.id, { onDelete: "cascade" }).notNull(),
  categoryId: uuid("category_id").references(() => serviceCategoriesTable.id, { onDelete: "cascade" }).notNull(),
  pricingModel: providerPricingModelEnum("pricing_model").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }),
  minimumCharge: decimal("minimum_charge", { precision: 10, scale: 2 }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  technicianCategoryUnique: uniqueIndex("technician_service_pricing_unique").on(table.technicianId, table.categoryId),
  nonnegativeAmount: check("technician_service_pricing_amount_check", sql`${table.amount} IS NULL OR ${table.amount} >= 0`),
  nonnegativeMinimum: check("technician_service_pricing_minimum_check", sql`${table.minimumCharge} IS NULL OR ${table.minimumCharge} >= 0`),
}));

export const providerAvailabilityTable = pgTable("provider_availability", {
  id: uuid("id").defaultRandom().primaryKey(),
  technicianId: uuid("technician_id").references(() => technicianProfilesTable.id, { onDelete: "cascade" }).notNull(),
  dayOfWeek: integer("day_of_week").notNull(),
  startsAt: varchar("starts_at", { length: 5 }).notNull(),
  endsAt: varchar("ends_at", { length: 5 }).notNull(),
  isAvailable: boolean("is_available").default(true).notNull(),
}, (table) => ({
  technicianDayIndex: index("provider_availability_technician_day_idx").on(table.technicianId, table.dayOfWeek),
  validDay: check("provider_availability_day_check", sql`${table.dayOfWeek} BETWEEN 0 AND 6`),
  timeOrder: check("provider_availability_time_check", sql`${table.startsAt} < ${table.endsAt}`),
}));

export const customerAddressesTable = pgTable("customer_addresses", {
  id: uuid("id").defaultRandom().primaryKey(),
  customerId: uuid("customer_id").references(() => usersTable.id, { onDelete: "cascade" }).notNull(),
  label: varchar("label", { length: 50 }),
  addressLine: text("address_line").notNull(),
  subcity: varchar("subcity", { length: 50 }),
  latitude: decimal("latitude", { precision: 10, scale: 8 }).notNull(),
  longitude: decimal("longitude", { precision: 11, scale: 8 }).notNull(),
  isDefault: boolean("is_default").default(false).notNull(),
});

export const serviceRequestsTable = pgTable("service_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  customerId: uuid("customer_id").references(() => usersTable.id, { onDelete: "restrict" }).notNull(),
  technicianId: uuid("technician_id").references(() => technicianProfilesTable.id, { onDelete: "set null" }),
  categoryId: uuid("category_id").references(() => serviceCategoriesTable.id, { onDelete: "restrict" }).notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 160 }).unique(),
  payloadHash: varchar("payload_hash", { length: 64 }),
  status: jobStatusEnum("status").default("REQUESTED").notNull(),
  problemDescription: text("problem_description").notNull(),
  address: text("address").notNull(),
  problemPhotos: text("problem_photos").array(),
  latitude: decimal("latitude", { precision: 10, scale: 8 }),
  longitude: decimal("longitude", { precision: 11, scale: 8 }),
  preferredAt: timestamp("preferred_at", { withTimezone: true }),
  budgetMin: decimal("budget_min", { precision: 10, scale: 2 }),
  budgetMax: decimal("budget_max", { precision: 10, scale: 2 }),
  urgency: varchar("urgency", { length: 24 }).default("STANDARD").notNull(),
  isEmergency: boolean("is_emergency").default(false).notNull(),
  estimatedPriceMin: decimal("estimated_price_min", { precision: 10, scale: 2 }).notNull(),
  estimatedPriceMax: decimal("estimated_price_max", { precision: 10, scale: 2 }).notNull(),
  finalPrice: decimal("final_price", { precision: 10, scale: 2 }),
  commissionAmount: decimal("commission_amount", { precision: 10, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  customerStatusIndex: index("service_requests_customer_status_idx").on(table.customerId, table.status),
  technicianStatusIndex: index("service_requests_technician_status_idx").on(table.technicianId, table.status),
  validLocation: check("service_requests_location_pair_check", sql`(${table.latitude} IS NULL) = (${table.longitude} IS NULL)`),
  validBudget: check("service_requests_budget_check", sql`${table.budgetMin} IS NULL OR ${table.budgetMax} IS NULL OR ${table.budgetMax} >= ${table.budgetMin}`),
}));

export const providerOffersTable = pgTable("provider_offers", {
  id: uuid("id").defaultRandom().primaryKey(),
  requestId: uuid("request_id").references(() => serviceRequestsTable.id, { onDelete: "cascade" }).notNull(),
  technicianId: uuid("technician_id").references(() => technicianProfilesTable.id, { onDelete: "cascade" }).notNull(),
  status: providerOfferStatusEnum("status").default("OFFERED").notNull(),
  quotedPrice: decimal("quoted_price", { precision: 10, scale: 2 }),
  message: text("message"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  requestTechnicianUnique: uniqueIndex("provider_offers_request_technician_unique").on(table.requestId, table.technicianId),
  technicianStatusIndex: index("provider_offers_technician_status_idx").on(table.technicianId, table.status, table.expiresAt),
}));

export const bookingsTable = pgTable("bookings", {
  id: uuid("id").defaultRandom().primaryKey(),
  requestId: uuid("request_id").references(() => serviceRequestsTable.id, { onDelete: "restrict" }).unique().notNull(),
  customerId: uuid("customer_id").references(() => usersTable.id, { onDelete: "restrict" }).notNull(),
  technicianId: uuid("technician_id").references(() => technicianProfilesTable.id, { onDelete: "restrict" }).notNull(),
  status: jobStatusEnum("status").default("ASSIGNED").notNull(),
  finalPrice: decimal("final_price", { precision: 10, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  customerStatusIndex: index("bookings_customer_status_idx").on(table.customerId, table.status),
  technicianStatusIndex: index("bookings_technician_status_idx").on(table.technicianId, table.status),
}));

export const bookingStatusHistoryTable = pgTable("booking_status_history", {
  id: uuid("id").defaultRandom().primaryKey(),
  bookingId: uuid("booking_id").references(() => bookingsTable.id, { onDelete: "cascade" }).notNull(),
  status: jobStatusEnum("status").notNull(),
  changedBy: uuid("changed_by").references(() => usersTable.id),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const paymentsTable = pgTable("payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  bookingId: uuid("booking_id").references(() => bookingsTable.id, { onDelete: "restrict" }).unique().notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  provider: varchar("provider", { length: 50 }).notNull(),
  providerReference: varchar("provider_reference", { length: 100 }).unique(),
  checkoutUrl: text("checkout_url"),
  status: paymentStatusEnum("status").default("PENDING").notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  failureReason: varchar("failure_reason", { length: 500 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const paymentWebhookEventsTable = pgTable("payment_webhook_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  provider: varchar("provider", { length: 50 }).notNull(),
  eventId: varchar("event_id", { length: 160 }).notNull(),
  payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  providerEventUnique: uniqueIndex("payment_webhook_events_provider_event_unique").on(table.provider, table.eventId),
}));

export const auditLogsTable = pgTable("audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  actorId: uuid("actor_id").references(() => usersTable.id, { onDelete: "set null" }),
  action: varchar("action", { length: 100 }).notNull(),
  entityType: varchar("entity_type", { length: 80 }).notNull(),
  entityId: varchar("entity_id", { length: 160 }).notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  entityCreatedIndex: index("audit_logs_entity_created_idx").on(table.entityType, table.entityId, table.createdAt),
  actorCreatedIndex: index("audit_logs_actor_created_idx").on(table.actorId, table.createdAt),
}));

export const reviewsTable = pgTable("reviews", {
  id: uuid("id").defaultRandom().primaryKey(),
  bookingId: uuid("booking_id").references(() => bookingsTable.id, { onDelete: "cascade" }).unique().notNull(),
  customerId: uuid("customer_id").references(() => usersTable.id).notNull(),
  technicianId: uuid("technician_id").references(() => technicianProfilesTable.id).notNull(),
  rating: integer("rating").notNull(),
  comment: text("comment"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const disputesTable = pgTable("disputes", {
  id: uuid("id").defaultRandom().primaryKey(),
  bookingId: uuid("booking_id").references(() => bookingsTable.id, { onDelete: "restrict" }).unique().notNull(),
  openedBy: uuid("opened_by").references(() => usersTable.id, { onDelete: "restrict" }).notNull(),
  reason: varchar("reason", { length: 80 }).notNull(),
  description: text("description").notNull(),
  status: disputeStatusEnum("status").default("OPEN").notNull(),
  resolution: text("resolution"),
  resolvedBy: uuid("resolved_by").references(() => usersTable.id),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const disputeEvidenceTable = pgTable("dispute_evidence", {
  id: uuid("id").defaultRandom().primaryKey(),
  disputeId: uuid("dispute_id").references(() => disputesTable.id, { onDelete: "cascade" }).notNull(),
  submittedBy: uuid("submitted_by").references(() => usersTable.id, { onDelete: "restrict" }).notNull(),
  url: text("url").notNull(),
  description: varchar("description", { length: 500 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const ledgerEntriesTable = pgTable("ledger_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  bookingId: uuid("booking_id").references(() => bookingsTable.id, { onDelete: "restrict" }).notNull(),
  userId: uuid("user_id").references(() => usersTable.id, { onDelete: "restrict" }),
  type: ledgerEntryTypeEnum("type").notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).default("ETB").notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 160 }).unique().notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  bookingIndex: index("ledger_entries_booking_idx").on(table.bookingId, table.createdAt),
  nonzeroAmount: check("ledger_entries_amount_check", sql`${table.amount} <> 0`),
}));

export const providerPayoutsTable = pgTable("provider_payouts", {
  id: uuid("id").defaultRandom().primaryKey(),
  technicianId: uuid("technician_id").references(() => technicianProfilesTable.id, { onDelete: "restrict" }).notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).default("ETB").notNull(),
  status: varchar("status", { length: 20 }).default("PENDING").notNull(),
  providerReference: varchar("provider_reference", { length: 120 }),
  proofUrl: text("proof_url"),
  idempotencyKey: varchar("idempotency_key", { length: 160 }).unique().notNull(),
  requestedAt: timestamp("requested_at", { withTimezone: true }).defaultNow().notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
}, (table) => ({
  nonnegativeAmount: check("provider_payout_amount_check", sql`${table.amount} > 0`),
}));

export const emergencyRequestsTable = pgTable("emergency_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  requestId: uuid("request_id").references(() => serviceRequestsTable.id, { onDelete: "restrict" }).unique().notNull(),
  emergencyType: varchar("emergency_type", { length: 80 }).notNull(),
  safetyAcknowledgedAt: timestamp("safety_acknowledged_at", { withTimezone: true }).notNull(),
  status: varchar("status", { length: 24 }).default("DISPATCHING").notNull(),
  etaMinutes: integer("eta_minutes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const conversationsTable = pgTable("conversations", {
  id: uuid("id").defaultRandom().primaryKey(),
  bookingId: uuid("booking_id").references(() => bookingsTable.id, { onDelete: "cascade" }).unique().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
});

export const messagesTable = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id").references(() => conversationsTable.id, { onDelete: "cascade" }).notNull(),
  senderId: uuid("sender_id").references(() => usersTable.id, { onDelete: "restrict" }).notNull(),
  body: text("body").notNull(),
  attachmentUrl: text("attachment_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  readAt: timestamp("read_at", { withTimezone: true }),
}, (table) => ({
  conversationCreatedIndex: index("messages_conversation_created_idx").on(table.conversationId, table.createdAt),
  nonemptyBody: check("messages_body_check", sql`length(trim(${table.body})) > 0 OR ${table.attachmentUrl} IS NOT NULL`),
}));

export const notificationsTable = pgTable("notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => usersTable.id, { onDelete: "cascade" }).notNull(),
  type: varchar("type", { length: 50 }).notNull(),
  title: varchar("title", { length: 160 }).notNull(),
  body: text("body").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().default({}).notNull(),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  userCreatedIndex: index("notifications_user_created_idx").on(table.userId, table.createdAt),
}));

export const serviceGuaranteesTable = pgTable("service_guarantees", {
  id: uuid("id").defaultRandom().primaryKey(),
  bookingId: uuid("booking_id").references(() => bookingsTable.id, { onDelete: "restrict" }).unique().notNull(),
  guaranteeDays: integer("guarantee_days").default(7).notNull(),
  validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
  status: varchar("status", { length: 20 }).default("ACTIVE").notNull(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertServiceCategorySchema = createInsertSchema(serviceCategoriesTable).omit({ id: true });
export const insertPricingRuleSchema = createInsertSchema(pricingRulesTable).omit({ id: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type InsertServiceCategory = z.infer<typeof insertServiceCategorySchema>;
export type InsertPricingRule = z.infer<typeof insertPricingRuleSchema>;
export type User = typeof usersTable.$inferSelect;
export type ServiceCategory = typeof serviceCategoriesTable.$inferSelect;
export type PricingRule = typeof pricingRulesTable.$inferSelect;