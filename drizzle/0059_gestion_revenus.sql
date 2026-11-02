CREATE TABLE "gestion_revenus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"libelle" text NOT NULL,
	"type" text DEFAULT 'commission' NOT NULL,
	"mandat" text,
	"montant_ht_cents" integer NOT NULL,
	"etat" text DEFAULT 'prevue' NOT NULL,
	"date" date NOT NULL,
	"date_encaissement" date,
	"reference_facture" text,
	"archivee_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "gestion_revenus" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gestion_revenus" ADD CONSTRAINT "gestion_revenus_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gestion_revenus_instance_idx" ON "gestion_revenus" USING btree ("instance_id","date");--> statement-breakpoint
CREATE POLICY "gestion_revenus_instance_isolation" ON "gestion_revenus" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);