ALTER TABLE "base_vivante" ADD COLUMN IF NOT EXISTS "email_entreprise" text;--> statement-breakpoint
ALTER TABLE "enrichissement_suggestions" ADD COLUMN IF NOT EXISTS "email_entreprise" text;