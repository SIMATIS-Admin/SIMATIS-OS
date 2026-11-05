CREATE TABLE "gestion_mandat_reglages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"mandat" text NOT NULL,
	"delai_paiement_jours" integer
);
--> statement-breakpoint
ALTER TABLE "gestion_mandat_reglages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gestion_ik_trajets" ADD COLUMN "refacturer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "gestion_mandat_reglages" ADD CONSTRAINT "gestion_mandat_reglages_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gestion_mandat_reglages_idx" ON "gestion_mandat_reglages" USING btree ("instance_id","mandat");--> statement-breakpoint
CREATE POLICY "gestion_mandat_reglages_instance_isolation" ON "gestion_mandat_reglages" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);