CREATE TABLE "salesnav_prospects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"base_id" uuid,
	"nom" text NOT NULL,
	"fonction" text,
	"entreprise" text,
	"lien_linkedin" text NOT NULL,
	"cible" text,
	"statut" text DEFAULT 'file' NOT NULL,
	"propose_le" timestamp with time zone,
	"demande_le" timestamp with time zone,
	"accepte_le" timestamp with time zone,
	"repondu_le" timestamp with time zone,
	"dernier_message_le" timestamp with time zone,
	"nb_messages" integer DEFAULT 0 NOT NULL,
	"opportunite_id" uuid
);
--> statement-breakpoint
ALTER TABLE "salesnav_prospects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "salesnav_prospects" ADD CONSTRAINT "salesnav_prospects_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesnav_prospects" ADD CONSTRAINT "salesnav_prospects_base_id_base_vivante_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."base_vivante"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesnav_prospects" ADD CONSTRAINT "salesnav_prospects_opportunite_id_opportunites_id_fk" FOREIGN KEY ("opportunite_id") REFERENCES "public"."opportunites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "salesnav_prospects_lien_idx" ON "salesnav_prospects" USING btree ("instance_id","lien_linkedin");--> statement-breakpoint
CREATE INDEX "salesnav_prospects_statut_idx" ON "salesnav_prospects" USING btree ("instance_id","statut");--> statement-breakpoint
CREATE POLICY "salesnav_prospects_instance_isolation" ON "salesnav_prospects" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);