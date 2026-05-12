CREATE TABLE "products" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"price" integer NOT NULL,
	"image_path" text NOT NULL,
	"file_path" text,
	"description" text,
	"specifications" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_best_seller" boolean DEFAULT false NOT NULL,
	"is_published" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_name_unique" UNIQUE("name"),
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_number" serial NOT NULL,
	"customer_name" text NOT NULL,
	"customer_email" text NOT NULL,
	"customer_dni" text,
	"items" jsonb NOT NULL,
	"total" integer NOT NULL,
	"is_plancha_grouped" boolean DEFAULT false NOT NULL,
	"requires_manual_prep" boolean DEFAULT false NOT NULL,
	"payment_method" text NOT NULL,
	"status" text DEFAULT 'paid' NOT NULL,
	"external_payment_id" varchar(255),
	"confirmation_source" text,
	"ars_to_usd_rate" numeric(12, 4),
	"paypal_usd_amount" numeric(12, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_security_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" varchar(32) NOT NULL,
	"reason" varchar(64) NOT NULL,
	"ip" text,
	"x_request_id" text,
	"signature_ts" text,
	"detail" text
);
--> statement-breakpoint
CREATE TABLE "webhook_alert_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" varchar(32) NOT NULL
);
--> statement-breakpoint
CREATE INDEX "webhook_security_events_created_at_idx" ON "webhook_security_events" USING btree ("created_at" DESC);--> statement-breakpoint
CREATE INDEX "webhook_alert_log_sent_at_idx" ON "webhook_alert_log" USING btree ("sent_at" DESC);