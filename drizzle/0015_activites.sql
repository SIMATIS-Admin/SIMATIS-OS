ALTER TABLE "opportunites" ADD COLUMN "derniere_activite" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "taches" ADD COLUMN "type" text DEFAULT 'tache' NOT NULL;--> statement-breakpoint
ALTER TABLE "taches" ADD COLUMN "type_choisi" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "taches" ADD COLUMN "avec_heure" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "taches" ADD COLUMN "duree_minutes" integer;--> statement-breakpoint
ALTER TABLE "taches" ADD COLUMN "occupe" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "options" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "taches" SET "type" = "canal";--> statement-breakpoint
-- Full HubSpot pass: activity types from the titles, and the deals' last activity date.
UPDATE "connexions" SET "derniere_synchro" = NULL WHERE "kind" = 'crm' AND "fournisseur" = 'hubspot';
