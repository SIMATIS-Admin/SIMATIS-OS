CREATE TABLE "connexions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"fournisseur" text NOT NULL,
	"reglages" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"etat" text DEFAULT 'non_configuree' NOT NULL,
	"derniere_synchro" timestamp with time zone,
	"derniere_tentative" timestamp with time zone,
	"derniere_erreur" text
);
--> statement-breakpoint
ALTER TABLE "connexions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "connexions" ADD CONSTRAINT "connexions_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connexions_instance_kind_idx" ON "connexions" USING btree ("instance_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_source_idx" ON "contacts" USING btree ("instance_id","source","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entreprises_source_idx" ON "entreprises" USING btree ("instance_id","source","source_id");--> statement-breakpoint
CREATE POLICY "connexions_instance_isolation" ON "connexions" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);