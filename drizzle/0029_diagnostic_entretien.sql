ALTER TABLE "diagnostic_projets" ADD COLUMN "pdf_entretien" text;--> statement-breakpoint
ALTER TABLE "diagnostic_projets" ADD COLUMN "pdf_entretien_nom" text;--> statement-breakpoint
ALTER TABLE "diagnostic_projets" ADD COLUMN "reponses_entretien" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "diagnostic_projets" ADD COLUMN "historique_reponses" jsonb DEFAULT '[]'::jsonb NOT NULL;