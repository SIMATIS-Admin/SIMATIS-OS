ALTER TABLE "entreprises" ADD COLUMN "siren" text;--> statement-breakpoint
CREATE INDEX "entreprises_siren_idx" ON "entreprises" USING btree ("instance_id","siren");