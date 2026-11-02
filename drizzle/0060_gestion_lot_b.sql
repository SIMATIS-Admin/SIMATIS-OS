CREATE TABLE "gestion_revenu_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revenu_id" uuid NOT NULL,
	"date_origine" date NOT NULL,
	"etat" text NOT NULL,
	"date_encaissement" date,
	"montant_ht_cents" integer,
	"reference_facture" text
);
--> statement-breakpoint
ALTER TABLE "gestion_revenu_exceptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gestion_revenus" ADD COLUMN "recurrence" text DEFAULT 'aucune' NOT NULL;--> statement-breakpoint
ALTER TABLE "gestion_revenus" ADD COLUMN "date_fin" date;--> statement-breakpoint
ALTER TABLE "gestion_revenus" ADD COLUMN "certitude" text DEFAULT 'certaine' NOT NULL;--> statement-breakpoint
ALTER TABLE "gestion_revenus" ADD COLUMN "depense_id" uuid;--> statement-breakpoint
ALTER TABLE "gestion_revenu_exceptions" ADD CONSTRAINT "gestion_revenu_exceptions_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion_revenu_exceptions" ADD CONSTRAINT "gestion_revenu_exceptions_revenu_id_gestion_revenus_id_fk" FOREIGN KEY ("revenu_id") REFERENCES "public"."gestion_revenus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gestion_revenu_exceptions_occ_idx" ON "gestion_revenu_exceptions" USING btree ("revenu_id","date_origine");--> statement-breakpoint
ALTER TABLE "gestion_revenus" ADD CONSTRAINT "gestion_revenus_depense_id_gestion_depenses_id_fk" FOREIGN KEY ("depense_id") REFERENCES "public"."gestion_depenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "gestion_revenu_exceptions_instance_isolation" ON "gestion_revenu_exceptions" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);