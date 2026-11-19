ALTER TABLE "devis" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "devis" ADD COLUMN "titre" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "devis" ADD COLUMN "contexte" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "devis" ADD COLUMN "objectifs" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "devis" ADD COLUMN "inclus" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "devis" ADD COLUMN "exclu" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "devis" ADD COLUMN "livrables" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "devis" ADD COLUMN "duree" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "devis" ADD COLUMN "debut" date;--> statement-breakpoint
ALTER TABLE "devis" ADD COLUMN "remise_pct" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "devis" ADD COLUMN "acompte_pct" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "devis" ADD COLUMN "frais" text DEFAULT 'refactures' NOT NULL;--> statement-breakpoint
ALTER TABLE "devis" ADD COLUMN "validite_jours" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "devis" ADD COLUMN "clauses" jsonb DEFAULT '[]'::jsonb NOT NULL;