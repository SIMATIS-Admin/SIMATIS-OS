CREATE TABLE "diagnostic_regles_journal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"projet_id" uuid NOT NULL,
	"fiche" text NOT NULL,
	"action" text NOT NULL,
	"libelle" text NOT NULL,
	"avant" text,
	"apres" text,
	"origine" text NOT NULL,
	"statut" text DEFAULT 'actif' NOT NULL,
	"motif_refus" text
);
--> statement-breakpoint
ALTER TABLE "diagnostic_regles_journal" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "diagnostic_regles_journal" ADD CONSTRAINT "diagnostic_regles_journal_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "diagnostic_regles_journal_instance_idx" ON "diagnostic_regles_journal" USING btree ("instance_id","created_at");--> statement-breakpoint
CREATE POLICY "diagnostic_regles_journal_instance_isolation" ON "diagnostic_regles_journal" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);