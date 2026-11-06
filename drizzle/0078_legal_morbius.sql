CREATE TABLE "gestion_factures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"mandat" text NOT NULL,
	"numero" text NOT NULL,
	"date_emission" date NOT NULL,
	"total_ht_cents" integer NOT NULL,
	"delai_jours" integer,
	"etat" text DEFAULT 'emise' NOT NULL,
	"date_encaissement" date,
	"lignes" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gestion_factures" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gestion_ik_trajets" ADD COLUMN "facture_id" uuid;--> statement-breakpoint
ALTER TABLE "gestion_factures" ADD CONSTRAINT "gestion_factures_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gestion_factures_numero_idx" ON "gestion_factures" USING btree ("instance_id","numero");--> statement-breakpoint
ALTER TABLE "gestion_ik_trajets" ADD CONSTRAINT "gestion_ik_trajets_facture_id_gestion_factures_id_fk" FOREIGN KEY ("facture_id") REFERENCES "public"."gestion_factures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "gestion_factures_instance_isolation" ON "gestion_factures" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);