CREATE TABLE "echanges_ajout" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"statut" text DEFAULT 'attente_claude' NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"brouillon" jsonb,
	"erreur" text,
	"demande_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sujet_id" uuid
);
--> statement-breakpoint
ALTER TABLE "echanges_ajout" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "echanges_ajout" ADD CONSTRAINT "echanges_ajout_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "echanges_ajout" ADD CONSTRAINT "echanges_ajout_sujet_id_sujets_id_fk" FOREIGN KEY ("sujet_id") REFERENCES "public"."sujets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "echanges_ajout_statut_idx" ON "echanges_ajout" USING btree ("instance_id","statut");--> statement-breakpoint
CREATE POLICY "echanges_ajout_instance_isolation" ON "echanges_ajout" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);