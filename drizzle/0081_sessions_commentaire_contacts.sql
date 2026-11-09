ALTER TABLE "enrichissement_taches" ADD COLUMN "commentaire" text;--> statement-breakpoint
ALTER TABLE "recherche_sessions" ADD COLUMN "commentaire" text;--> statement-breakpoint
ALTER TABLE "recherche_sessions" ADD COLUMN "contacts" jsonb;