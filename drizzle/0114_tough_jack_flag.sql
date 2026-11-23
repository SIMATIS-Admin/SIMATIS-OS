CREATE TABLE "salesnav_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"type" text NOT NULL,
	"opportunite_id" uuid,
	"campagne_id" uuid
);
--> statement-breakpoint
ALTER TABLE "salesnav_actions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "salesnav_actions" ADD CONSTRAINT "salesnav_actions_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesnav_actions" ADD CONSTRAINT "salesnav_actions_opportunite_id_opportunites_id_fk" FOREIGN KEY ("opportunite_id") REFERENCES "public"."opportunites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesnav_actions" ADD CONSTRAINT "salesnav_actions_campagne_id_salesnav_campagnes_id_fk" FOREIGN KEY ("campagne_id") REFERENCES "public"."salesnav_campagnes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "salesnav_actions_instance_idx" ON "salesnav_actions" USING btree ("instance_id","created_at");--> statement-breakpoint
CREATE POLICY "salesnav_actions_instance_isolation" ON "salesnav_actions" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);