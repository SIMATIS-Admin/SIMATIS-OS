ALTER TABLE "diagnostic_projets" ADD COLUMN "rapport_versions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "diagnostic_projets" ADD COLUMN "restitution_statut" text DEFAULT 'aucun' NOT NULL;--> statement-breakpoint
ALTER TABLE "diagnostic_projets" ADD COLUMN "restitution_lien" text;--> statement-breakpoint
ALTER TABLE "diagnostic_projets" ADD COLUMN "restitution_liens" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "diagnostic_projets" ADD COLUMN "restitution_avec_proposition" boolean DEFAULT true NOT NULL;