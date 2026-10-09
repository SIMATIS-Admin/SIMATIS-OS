CREATE TABLE "devis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opportunite_id" uuid NOT NULL,
	"numero" text NOT NULL,
	"statut" text DEFAULT 'brouillon' NOT NULL,
	"lignes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"envoye_le" timestamp with time zone,
	"validite" date
);
--> statement-breakpoint
ALTER TABLE "devis" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "devis" ADD CONSTRAINT "devis_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devis" ADD CONSTRAINT "devis_opportunite_id_opportunites_id_fk" FOREIGN KEY ("opportunite_id") REFERENCES "public"."opportunites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "devis_instance_idx" ON "devis" USING btree ("instance_id");--> statement-breakpoint
CREATE UNIQUE INDEX "devis_numero_idx" ON "devis" USING btree ("instance_id","numero");--> statement-breakpoint
CREATE POLICY "devis_instance_isolation" ON "devis" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);