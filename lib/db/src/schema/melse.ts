import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  decimal,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const userRoleEnum = pgEnum("user_role", ["CUSTOMER", "TECHNICIAN", "ADMIN", "BUSINESS"]);
export const verificationStatusEnum = pgEnum("verification_status", ["PENDING", "UNDER_REVIEW", "VERIFIED", "SUSPENDED", "REJECTED"]);
export const jobStatusEnum = pgEnum("job_status", ["REQUESTED", "SEARCHING", "ASSIGNED", "ACCEPTED", "TECHNICIAN_EN_ROUTE", "ARRIVED", "IN_PROGRESS", "COMPLETED", "CUSTOMER_CONFIRMED", "PAID", "RATED", "CANCELLED", "DISPUTED", "REFUNDED", "REASSIGNED"]);
export const paymentStatusEnum = pgEnum("payment_status", ["PENDING", "PROCESSING", "COMPLETED", "FAILED", "REFUNDED"]);

export const usersTable = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  phoneNumber: varchar("phone_number", { length: 20 }).unique().notNull(),
  fullName: varchar("full_name", { length: 100 }).notNull(),
  role: userRoleEnum("role").default("CUSTOMER").notNull(),
  avatarUrl: text("avatar_url"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
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
  problemPhotos: text("problem_photos").array(),
  latitude: decimal("latitude", { precision: 10, scale: 8 }).notNull(),
  longitude: decimal("longitude", { precision: 11, scale: 8 }).notNull(),
  estimatedPriceMin: decimal("estimated_price_min", { precision: 10, scale: 2 }).notNull(),
  estimatedPriceMax: decimal("estimated_price_max", { precision: 10, scale: 2 }).notNull(),
  finalPrice: decimal("final_price", { precision: 10, scale: 2 }),
  commissionAmount: decimal("commission_amount", { precision: 10, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const bookingStatusHistoryTable = pgTable("booking_status_history", {
  id: uuid("id").defaultRandom().primaryKey(),
  bookingId: uuid("booking_id").references(() => serviceRequestsTable.id, { onDelete: "cascade" }).notNull(),
  status: jobStatusEnum("status").notNull(),
  changedBy: uuid("changed_by").references(() => usersTable.id),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const paymentsTable = pgTable("payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  bookingId: uuid("booking_id").references(() => serviceRequestsTable.id, { onDelete: "restrict" }).unique().notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  provider: varchar("provider", { length: 50 }).notNull(),
  providerReference: varchar("provider_reference", { length: 100 }),
  status: paymentStatusEnum("status").default("PENDING").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const reviewsTable = pgTable("reviews", {
  id: uuid("id").defaultRandom().primaryKey(),
  bookingId: uuid("booking_id").references(() => serviceRequestsTable.id, { onDelete: "cascade" }).unique().notNull(),
  customerId: uuid("customer_id").references(() => usersTable.id).notNull(),
  technicianId: uuid("technician_id").references(() => technicianProfilesTable.id).notNull(),
  rating: integer("rating").notNull(),
  comment: text("comment"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const serviceGuaranteesTable = pgTable("service_guarantees", {
  id: uuid("id").defaultRandom().primaryKey(),
  bookingId: uuid("booking_id").references(() => serviceRequestsTable.id, { onDelete: "restrict" }).unique().notNull(),
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