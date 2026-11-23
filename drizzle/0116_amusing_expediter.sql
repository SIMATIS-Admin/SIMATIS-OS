CREATE TABLE "salesnav_envois" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"prospect_id" uuid NOT NULL,
	"note" text NOT NULL,
	"statut" text DEFAULT 'en_attente' NOT NULL,
	"essai" boolean DEFAULT true NOT NULL,
	"detail" text,
	"termine_le" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "salesnav_envois" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "salesnav_actions" ADD COLUMN "origine" text DEFAULT 'manuel' NOT NULL;--> statement-breakpoint
ALTER TABLE "salesnav_reglages" ADD COLUMN "essai_a_blanc" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "salesnav_reglages" ADD COLUMN "pause_raison" text;--> statement-breakpoint
ALTER TABLE "salesnav_reglages" ADD COLUMN "pause_jusqua" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "salesnav_envois" ADD CONSTRAINT "salesnav_envois_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesnav_envois" ADD CONSTRAINT "salesnav_envois_prospect_id_salesnav_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."salesnav_prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "salesnav_envois_ouvert_idx" ON "salesnav_envois" USING btree ("instance_id") WHERE statut in ('en_attente', 'en_cours');--> statement-breakpoint
CREATE INDEX "salesnav_envois_prospect_idx" ON "salesnav_envois" USING btree ("prospect_id","created_at");--> statement-breakpoint
CREATE POLICY "salesnav_envois_instance_isolation" ON "salesnav_envois" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);