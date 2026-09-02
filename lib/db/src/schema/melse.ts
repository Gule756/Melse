import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  decimal,
  integer,
  index,
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
export const verificationStatusEnum = pgEnum("verification_status", ["PENDING", "UNDER_REVIEW", "VERIFIED", "SUSPENDED", "REJECTED"]);
export const jobStatusEnum = pgEnum("job_status", ["REQUESTED", "SEARCHING", "ASSIGNED", "ACCEPTED", "TECHNICIAN_EN_ROUTE", "ARRIVED", "IN_PROGRESS", "COMPLETED", "CUSTOMER_CONFIRMED", "PAID", "RATED", "CANCELLED", "DISPUTED", "REFUNDED", "REASSIGNED"]);
export const paymentStatusEnum = pgEnum("payment_status", ["PENDING", "PROCESSING", "COMPLETED", "FAILED", "REFUNDED"]);

export const usersTable = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  phoneNumber: varchar("phone_number", { length: 20 }).unique().notNull(),
  fullName: varchar("full_name", { length: 100 }).notNull(),
  passwordHash: text("password_hash").notNull(),
  role: userRoleEnum("role").default("CUSTOMER").notNull(),
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
});

export const passwordResetTokensTable = pgTable("password_reset_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => usersTable.id, { onDelete: "cascade" }).notNull(),
  tokenHash: varchar("token_hash", { length: 128 }).unique().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

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
  ratingAvg: decimal("rating_avg", { precision: 3, scale: 2 }).default("5").notNull(),
  ratingCount: integer("rating_count").default(0).notNull(),
  isAvailable: boolean("is_available").default(false).notNull(),
  currentLatitude: decimal("current_latitude", { precision: 10, scale: 8 }),
  currentLongitude: decimal("current_longitude", { precision: 11, scale: 8 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const technicianSkillsTable = pgTable("technician_skills", {
  technicianId: uuid("technician_id").references(() => technicianProfilesTable.id, { onDelete: "cascade" }).notNull(),
  categoryId: uuid("category_id").references(() => serviceCategoriesTable.id, { onDelete: "cascade" }).notNull(),
});

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
  status: jobStatusEnum("status").default("REQUESTED").notNull(),
  problemDescription: text("problem_description").notNull(),
  address: text("address").notNull(),
  problemPhotos: text("problem_photos").array(),
  latitude: decimal("latitude", { precision: 10, scale: 8 }).notNull(),
  longitude: decimal("longitude", { precision: 11, scale: 8 }).notNull(),
  estimatedPriceMin: decimal("estimated_price_min", { precision: 10, scale: 2 }).notNull(),
  estimatedPriceMax: decimal("estimated_price_max", { precision: 10, scale: 2 }).notNull(),
  finalPrice: decimal("final_price", { precision: 10, scale: 2 }),
  commissionAmount: decimal("commission_amount", { precision: 10, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  customerStatusIndex: index("service_requests_customer_status_idx").on(table.customerId, table.status),
  technicianStatusIndex: index("service_requests_technician_status_idx").on(table.technicianId, table.status),
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
  providerReference: varchar("provider_reference", { length: 100 }),
  status: paymentStatusEnum("status").default("PENDING").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const reviewsTable = pgTable("reviews", {
  id: uuid("id").defaultRandom().primaryKey(),
  bookingId: uuid("booking_id").references(() => bookingsTable.id, { onDelete: "cascade" }).unique().notNull(),
  customerId: uuid("customer_id").references(() => usersTable.id).notNull(),
  technicianId: uuid("technician_id").references(() => technicianProfilesTable.id).notNull(),
  rating: integer("rating").notNull(),
  comment: text("comment"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

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