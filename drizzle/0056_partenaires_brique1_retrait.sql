DROP POLICY "donnees_envoyees_instance_isolation" ON "donnees_envoyees" CASCADE;--> statement-breakpoint
DROP TABLE "donnees_envoyees" CASCADE;--> statement-breakpoint
ALTER TABLE "partenaires" DROP COLUMN "partage";