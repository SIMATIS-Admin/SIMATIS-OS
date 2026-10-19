ALTER TABLE "diagnostic_projets" ADD COLUMN "demande" text;--> statement-breakpoint
ALTER TABLE "diagnostic_projets" ADD COLUMN "dit_par_dirigeant" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "diagnostic_projets" ADD COLUMN "hypotheses" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "diagnostic_projets" ADD COLUMN "logo" text;--> statement-breakpoint
ALTER TABLE "diagnostic_projets" ADD COLUMN "logo_nom" text;--> statement-breakpoint
ALTER TABLE "diagnostic_projets" ADD COLUMN "support_statut" text DEFAULT 'aucun' NOT NULL;--> statement-breakpoint
ALTER TABLE "diagnostic_projets" ADD COLUMN "support_lien" text;--> statement-breakpoint
ALTER TABLE "diagnostic_projets" ADD COLUMN "support_texte" jsonb;--> statement-breakpoint
ALTER TABLE "diagnostic_projets" ADD COLUMN "support_final_le" timestamp with time zone;