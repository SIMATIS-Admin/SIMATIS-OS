ALTER TABLE "diagnostic_projets" ADD COLUMN "revue_export_statut" text DEFAULT 'aucun' NOT NULL;--> statement-breakpoint
ALTER TABLE "diagnostic_projets" ADD COLUMN "revue_export_lien" text;