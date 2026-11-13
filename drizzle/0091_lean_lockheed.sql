ALTER TABLE "rendez_vous" ADD COLUMN "tri" text DEFAULT 'aucun' NOT NULL;
--> statement-breakpoint
-- Ce que Marc a déjà trié ou documenté reste son choix : le classement automatique n'y touche pas.
UPDATE "rendez_vous" SET "tri" = 'manuel' WHERE "statut" <> 'a_trier' OR "compte_rendu" IS NOT NULL;
