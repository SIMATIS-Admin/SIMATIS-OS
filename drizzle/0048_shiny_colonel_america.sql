ALTER TABLE "diagnostic_projets" ADD COLUMN "capitalisation_statut" text DEFAULT 'aucun' NOT NULL;--> statement-breakpoint
ALTER TABLE "diagnostic_projets" ADD COLUMN "capitalisation_rdv_id" uuid;--> statement-breakpoint
ALTER TABLE "diagnostic_projets" ADD COLUMN "capitalisation_compte_rendu_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "diagnostic_projets" ADD CONSTRAINT "diagnostic_projets_capitalisation_rdv_id_rendez_vous_id_fk" FOREIGN KEY ("capitalisation_rdv_id") REFERENCES "public"."rendez_vous"("id") ON DELETE set null ON UPDATE no action;