ALTER TABLE "taches" ADD COLUMN "notes" text;--> statement-breakpoint
-- Full HubSpot pass after the update: existing tasks get their type from their title, and their notes.
UPDATE "connexions" SET "derniere_synchro" = NULL WHERE "kind" = 'crm' AND "fournisseur" = 'hubspot';
