ALTER TABLE "base_entreprises" ADD COLUMN "site_telephones" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "base_entreprises" ADD COLUMN "site_emails" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "base_entreprises" ADD COLUMN "linkedin" text;--> statement-breakpoint
ALTER TABLE "base_entreprises" ADD COLUMN "site_confirme" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "base_entreprises" ADD COLUMN "site_lu_le" timestamp with time zone;