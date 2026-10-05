CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" varchar(100) NOT NULL,
	"entity_type" varchar(80) NOT NULL,
	"entity_id" varchar(160) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(50) NOT NULL,
	"event_id" varchar(160) NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "technician_profiles" ALTER COLUMN "rating_avg" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "checkout_url" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "failure_reason" varchar(500);--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD COLUMN "customer_fee" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD COLUMN "included_distance_km" numeric(6, 2) DEFAULT '5' NOT NULL;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD COLUMN "per_km_rate" numeric(10, 2) DEFAULT '30' NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_payouts" ADD COLUMN "proof_url" text;--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "idempotency_key" varchar(160);--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "payload_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_entity_created_idx" ON "audit_logs" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_created_idx" ON "audit_logs" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_webhook_events_provider_event_unique" ON "payment_webhook_events" USING btree ("provider","event_id");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_provider_reference_unique" UNIQUE("provider_reference");--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_idempotency_key_unique" UNIQUE("idempotency_key");