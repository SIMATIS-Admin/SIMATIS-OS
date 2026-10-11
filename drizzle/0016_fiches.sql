ALTER TABLE "activites" ADD COLUMN "entreprise_id" uuid;--> statement-breakpoint
ALTER TABLE "activites" ADD COLUMN "opportunite_id" uuid;--> statement-breakpoint
ALTER TABLE "activites" ADD COLUMN "titre" text;--> statement-breakpoint
ALTER TABLE "opportunites" ADD COLUMN "etapes_dates" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "activites" ADD CONSTRAINT "activites_entreprise_id_entreprises_id_fk" FOREIGN KEY ("entreprise_id") REFERENCES "public"."entreprises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activites" ADD CONSTRAINT "activites_opportunite_id_opportunites_id_fk" FOREIGN KEY ("opportunite_id") REFERENCES "public"."opportunites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Full HubSpot pass: history (notes, calls, emails, meetings) and stage entry dates.
UPDATE "connexions" SET "derniere_synchro" = NULL WHERE "kind" = 'crm' AND "fournisseur" = 'hubspot';
