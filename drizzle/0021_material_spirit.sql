CREATE TABLE "diagnostic_projets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"nom" text NOT NULL,
	"activite" text NOT NULL,
	"contexte" text DEFAULT '' NOT NULL,
	"etape" integer DEFAULT 1 NOT NULL,
	"dims" jsonb,
	"statut_diagnostic" text,
	"date_diagnostic" date,
	"chats" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "diagnostic_projets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "diagnostic_projets" ADD CONSTRAINT "diagnostic_projets_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "diagnostic_projets_instance_idx" ON "diagnostic_projets" USING btree ("instance_id");--> statement-breakpoint
CREATE POLICY "diagnostic_projets_instance_isolation" ON "diagnostic_projets" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);