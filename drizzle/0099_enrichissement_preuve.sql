ALTER TABLE "enrichissement_suggestions" ADD COLUMN "preuve" text;--> statement-breakpoint
ALTER TABLE "enrichissement_suggestions" ADD COLUMN "appliquee_auto" boolean DEFAULT false NOT NULL;