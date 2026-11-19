ALTER TABLE "opportunites" ADD COLUMN "radar_canal_manuel" text;--> statement-breakpoint
ALTER TABLE "opportunites" ADD COLUMN "radar_etapes_dates" jsonb DEFAULT '{}'::jsonb NOT NULL;