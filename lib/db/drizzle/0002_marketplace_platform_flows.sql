CREATE TYPE "public"."dispute_status" AS ENUM('OPEN', 'UNDER_REVIEW', 'RESOLVED_CUSTOMER', 'RESOLVED_PROVIDER', 'PARTIALLY_REFUNDED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."ledger_entry_type" AS ENUM('CUSTOMER_PAYMENT', 'PLATFORM_COMMISSION', 'PROVIDER_EARNING', 'REFUND', 'PAYOUT');--> statement-breakpoint
CREATE TYPE "public"."provider_offer_status" AS ENUM('OFFERED', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."provider_pricing_model" AS ENUM('FIXED', 'HOURLY', 'QUOTE');--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone,
	CONSTRAINT "conversations_booking_id_unique" UNIQUE("booking_id")
);
--> statement-breakpoint
CREATE TABLE "dispute_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dispute_id" uuid NOT NULL,
	"submitted_by" uuid NOT NULL,
	"url" text NOT NULL,
	"description" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"opened_by" uuid NOT NULL,
	"reason" varchar(80) NOT NULL,
	"description" text NOT NULL,
	"status" "dispute_status" DEFAULT 'OPEN' NOT NULL,
	"resolution" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "disputes_booking_id_unique" UNIQUE("booking_id")
);
--> statement-breakpoint
CREATE TABLE "emergency_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"emergency_type" varchar(80) NOT NULL,
	"safety_acknowledged_at" timestamp with time zone NOT NULL,
	"status" varchar(24) DEFAULT 'DISPATCHING' NOT NULL,
	"eta_minutes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "emergency_requests_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"user_id" uuid,
	"type" "ledger_entry_type" NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'ETB' NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "ledger_entries_amount_check" CHECK ("ledger_entries"."amount" <> 0)
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"body" text NOT NULL,
	"attachment_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "messages_body_check" CHECK (length(trim("messages"."body")) > 0 OR "messages"."attachment_url" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(50) NOT NULL,
	"title" varchar(160) NOT NULL,
	"body" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"technician_id" uuid NOT NULL,
	"day_of_week" integer NOT NULL,
	"starts_at" varchar(5) NOT NULL,
	"ends_at" varchar(5) NOT NULL,
	"is_available" boolean DEFAULT true NOT NULL,
	CONSTRAINT "provider_availability_day_check" CHECK ("provider_availability"."day_of_week" BETWEEN 0 AND 6),
	CONSTRAINT "provider_availability_time_check" CHECK ("provider_availability"."starts_at" < "provider_availability"."ends_at")
);
--> statement-breakpoint
CREATE TABLE "provider_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"technician_id" uuid NOT NULL,
	"status" "provider_offer_status" DEFAULT 'OFFERED' NOT NULL,
	"quoted_price" numeric(10, 2),
	"message" text,
	"expires_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"technician_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'ETB' NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"provider_reference" varchar(120),
	"idempotency_key" varchar(160) NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "provider_payouts_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "provider_payout_amount_check" CHECK ("provider_payouts"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "technician_service_pricing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"technician_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"pricing_model" "provider_pricing_model" NOT NULL,
	"amount" numeric(10, 2),
	"minimum_charge" numeric(10, 2),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "technician_service_pricing_amount_check" CHECK ("technician_service_pricing"."amount" IS NULL OR "technician_service_pricing"."amount" >= 0),
	CONSTRAINT "technician_service_pricing_minimum_check" CHECK ("technician_service_pricing"."minimum_charge" IS NULL OR "technician_service_pricing"."minimum_charge" >= 0)
);
--> statement-breakpoint
ALTER TABLE "service_requests" ALTER COLUMN "latitude" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "service_requests" ALTER COLUMN "longitude" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "preferred_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "budget_min" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "budget_max" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "urgency" varchar(24) DEFAULT 'STANDARD' NOT NULL;--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "is_emergency" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "technician_profiles" ADD COLUMN "location_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "technician_profiles" ADD COLUMN "service_radius_km" numeric(6, 2) DEFAULT '15' NOT NULL;--> statement-breakpoint
ALTER TABLE "technician_profiles" ADD COLUMN "emergency_eligible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_evidence" ADD CONSTRAINT "dispute_evidence_dispute_id_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."disputes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_evidence" ADD CONSTRAINT "dispute_evidence_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emergency_requests" ADD CONSTRAINT "emergency_requests_request_id_service_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."service_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_availability" ADD CONSTRAINT "provider_availability_technician_id_technician_profiles_id_fk" FOREIGN KEY ("technician_id") REFERENCES "public"."technician_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_offers" ADD CONSTRAINT "provider_offers_request_id_service_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."service_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_offers" ADD CONSTRAINT "provider_offers_technician_id_technician_profiles_id_fk" FOREIGN KEY ("technician_id") REFERENCES "public"."technician_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_payouts" ADD CONSTRAINT "provider_payouts_technician_id_technician_profiles_id_fk" FOREIGN KEY ("technician_id") REFERENCES "public"."technician_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "technician_service_pricing" ADD CONSTRAINT "technician_service_pricing_technician_id_technician_profiles_id_fk" FOREIGN KEY ("technician_id") REFERENCES "public"."technician_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "technician_service_pricing" ADD CONSTRAINT "technician_service_pricing_category_id_service_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."service_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_entries_booking_idx" ON "ledger_entries" USING btree ("booking_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_conversation_created_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "provider_availability_technician_day_idx" ON "provider_availability" USING btree ("technician_id","day_of_week");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_offers_request_technician_unique" ON "provider_offers" USING btree ("request_id","technician_id");--> statement-breakpoint
CREATE INDEX "provider_offers_technician_status_idx" ON "provider_offers" USING btree ("technician_id","status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "technician_service_pricing_unique" ON "technician_service_pricing" USING btree ("technician_id","category_id");--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_location_pair_check" CHECK (("service_requests"."latitude" IS NULL) = ("service_requests"."longitude" IS NULL));--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_budget_check" CHECK ("service_requests"."budget_min" IS NULL OR "service_requests"."budget_max" IS NULL OR "service_requests"."budget_max" >= "service_requests"."budget_min");--> statement-breakpoint
ALTER TABLE "technician_profiles" ADD CONSTRAINT "technician_profiles_service_radius_check" CHECK ("technician_profiles"."service_radius_km" > 0);