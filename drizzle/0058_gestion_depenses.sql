CREATE TABLE "gestion_depense_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"depense_id" uuid NOT NULL,
	"date_origine" date NOT NULL,
	"etat" text NOT NULL,
	"date_paiement" date,
	"montant_ttc_cents" integer
);
--> statement-breakpoint
ALTER TABLE "gestion_depense_exceptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "gestion_depenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"libelle" text NOT NULL,
	"categorie" text,
	"montant_ttc_cents" integer NOT NULL,
	"tva_cents" integer,
	"statut" text NOT NULL,
	"recurrence" text DEFAULT 'aucune' NOT NULL,
	"date_debut" date NOT NULL,
	"date_fin" date,
	"payeur" text DEFAULT 'societe' NOT NULL,
	"affectations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"refacturable" boolean DEFAULT false NOT NULL,
	"justificatif" text,
	"archivee_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "gestion_depenses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gestion_depense_exceptions" ADD CONSTRAINT "gestion_depense_exceptions_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion_depense_exceptions" ADD CONSTRAINT "gestion_depense_exceptions_depense_id_gestion_depenses_id_fk" FOREIGN KEY ("depense_id") REFERENCES "public"."gestion_depenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion_depenses" ADD CONSTRAINT "gestion_depenses_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gestion_depense_exceptions_occ_idx" ON "gestion_depense_exceptions" USING btree ("depense_id","date_origine");--> statement-breakpoint
CREATE INDEX "gestion_depenses_instance_idx" ON "gestion_depenses" USING btree ("instance_id","date_debut");--> statement-breakpoint
CREATE POLICY "gestion_depense_exceptions_instance_isolation" ON "gestion_depense_exceptions" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "gestion_depenses_instance_isolation" ON "gestion_depenses" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);