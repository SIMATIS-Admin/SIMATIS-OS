CREATE TABLE "base_entreprises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"siren" text NOT NULL,
	"nom" text NOT NULL,
	"forme_juridique" text,
	"naf" text,
	"categorie" text,
	"effectif" text,
	"cree_le" date,
	"active" boolean DEFAULT true NOT NULL,
	"etablissements_ouverts" integer,
	"opposition_diffusion" boolean DEFAULT false NOT NULL,
	"siret" text,
	"adresse" text,
	"code_postal" text,
	"ville" text,
	"departement" text,
	"latitude" double precision,
	"longitude" double precision,
	"finances" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dirigeants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"site_web" text,
	"annuaire_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "base_entreprises" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "base_vivante" ADD COLUMN "entreprise_id" uuid;--> statement-breakpoint
ALTER TABLE "base_entreprises" ADD CONSTRAINT "base_entreprises_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "base_entreprises_siren_idx" ON "base_entreprises" USING btree ("instance_id","siren");--> statement-breakpoint
CREATE INDEX "base_entreprises_instance_idx" ON "base_entreprises" USING btree ("instance_id");--> statement-breakpoint
ALTER TABLE "base_vivante" ADD CONSTRAINT "base_vivante_entreprise_id_base_entreprises_id_fk" FOREIGN KEY ("entreprise_id") REFERENCES "public"."base_entreprises"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "base_entreprises_instance_isolation" ON "base_entreprises" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);