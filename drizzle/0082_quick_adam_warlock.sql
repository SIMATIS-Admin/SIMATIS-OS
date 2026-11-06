ALTER TABLE "diagnostic_projets" ADD COLUMN "dossier_export_statut" text DEFAULT 'aucun' NOT NULL;--> statement-breakpoint
ALTER TABLE "diagnostic_projets" ADD COLUMN "dossier_export_lien" text;