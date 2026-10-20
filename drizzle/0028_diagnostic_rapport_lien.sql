ALTER TABLE "diagnostic_projets" ADD COLUMN "rapport_lien_statut" text DEFAULT 'aucun' NOT NULL;--> statement-breakpoint
ALTER TABLE "diagnostic_projets" ADD COLUMN "rapport_lien" text;--> statement-breakpoint
ALTER TABLE "diagnostic_projets" ADD COLUMN "rapport_liens" jsonb DEFAULT '[]'::jsonb NOT NULL;