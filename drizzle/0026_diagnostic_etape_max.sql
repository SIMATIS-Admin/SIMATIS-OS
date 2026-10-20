ALTER TABLE "diagnostic_projets" ADD COLUMN "etape_max" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
-- Projets existants : l'étape en cours est la plus haute connue.
UPDATE "diagnostic_projets" SET "etape_max" = "etape";
