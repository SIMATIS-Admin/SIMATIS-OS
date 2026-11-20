ALTER TABLE "devis" ADD COLUMN "frais_plafond" integer;--> statement-breakpoint
ALTER TABLE "devis" ADD COLUMN "frais_texte" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "devis" ADD COLUMN "mode_prix" text DEFAULT 'forfait' NOT NULL;--> statement-breakpoint
ALTER TABLE "devis" ADD COLUMN "sortie_mois" integer;--> statement-breakpoint
ALTER TABLE "devis" ADD COLUMN "texte_sortie" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "devis" ADD COLUMN "conditions_particulieres" text DEFAULT '' NOT NULL;