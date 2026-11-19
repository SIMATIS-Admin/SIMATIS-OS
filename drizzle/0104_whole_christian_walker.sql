CREATE TABLE "devis_clauses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"titre" text NOT NULL,
	"texte" text DEFAULT '' NOT NULL,
	"par_defaut" boolean DEFAULT false NOT NULL,
	"ordre" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "devis_clauses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "devis_modeles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"nom" text NOT NULL,
	"contexte" text DEFAULT '' NOT NULL,
	"objectifs" text DEFAULT '' NOT NULL,
	"inclus" text DEFAULT '' NOT NULL,
	"exclu" text DEFAULT '' NOT NULL,
	"livrables" text DEFAULT '' NOT NULL,
	"duree" text DEFAULT '' NOT NULL,
	"lignes" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "devis_modeles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "devis_reglages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"numerotation" text DEFAULT 'DEV-{AAAA}-{NNN}' NOT NULL,
	"mentions" text DEFAULT '' NOT NULL,
	"tva_pct" integer DEFAULT 20 NOT NULL,
	"validite_jours" integer DEFAULT 30 NOT NULL,
	"acompte_pct" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "devis_reglages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "devis_clauses" ADD CONSTRAINT "devis_clauses_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devis_modeles" ADD CONSTRAINT "devis_modeles_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devis_reglages" ADD CONSTRAINT "devis_reglages_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "devis_clauses_instance_idx" ON "devis_clauses" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "devis_modeles_instance_idx" ON "devis_modeles" USING btree ("instance_id");--> statement-breakpoint
CREATE UNIQUE INDEX "devis_reglages_instance_idx" ON "devis_reglages" USING btree ("instance_id");--> statement-breakpoint
CREATE POLICY "devis_clauses_instance_isolation" ON "devis_clauses" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "devis_modeles_instance_isolation" ON "devis_modeles" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "devis_reglages_instance_isolation" ON "devis_reglages" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);