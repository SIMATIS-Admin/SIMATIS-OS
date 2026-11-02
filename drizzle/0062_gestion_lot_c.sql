CREATE TABLE "gestion_reglages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"solde_cents" integer,
	"solde_date" date,
	"solde_source" text,
	"seuil_mode" text DEFAULT 'aucun' NOT NULL,
	"seuil_cents" integer,
	"delai_paiement_jours" integer
);
--> statement-breakpoint
ALTER TABLE "gestion_reglages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "gestion_tva_mois" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"mois" text NOT NULL,
	"declaree_cents" integer,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "gestion_tva_mois" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gestion_revenus" ADD COLUMN "tva_cents" integer;--> statement-breakpoint
ALTER TABLE "gestion_reglages" ADD CONSTRAINT "gestion_reglages_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion_tva_mois" ADD CONSTRAINT "gestion_tva_mois_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gestion_reglages_instance_idx" ON "gestion_reglages" USING btree ("instance_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gestion_tva_mois_idx" ON "gestion_tva_mois" USING btree ("instance_id","mois");--> statement-breakpoint
CREATE POLICY "gestion_reglages_instance_isolation" ON "gestion_reglages" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "gestion_tva_mois_instance_isolation" ON "gestion_tva_mois" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);