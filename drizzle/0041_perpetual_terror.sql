ALTER TABLE "opportunites" ADD COLUMN "mode_facturation" text DEFAULT 'spot' NOT NULL;--> statement-breakpoint
ALTER TABLE "opportunites" ADD COLUMN "duree_engagement_mois" integer DEFAULT 12 NOT NULL;--> statement-breakpoint
ALTER TABLE "opportunites" ADD COLUMN "tacite_reconduction" boolean DEFAULT true NOT NULL;