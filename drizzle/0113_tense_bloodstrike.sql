CREATE TABLE "salesnav_campagnes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"nom" text NOT NULL,
	"icp" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "salesnav_campagnes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "salesnav_modeles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"icp" text NOT NULL,
	"etape" text NOT NULL,
	"campagne_id" uuid,
	"texte" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "salesnav_modeles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "salesnav_reglages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"quota_jour" integer DEFAULT 8 NOT NULL,
	"pause" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "salesnav_reglages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "salesnav_campagnes" ADD CONSTRAINT "salesnav_campagnes_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesnav_modeles" ADD CONSTRAINT "salesnav_modeles_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesnav_modeles" ADD CONSTRAINT "salesnav_modeles_campagne_id_salesnav_campagnes_id_fk" FOREIGN KEY ("campagne_id") REFERENCES "public"."salesnav_campagnes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesnav_reglages" ADD CONSTRAINT "salesnav_reglages_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "salesnav_campagnes_nom_idx" ON "salesnav_campagnes" USING btree ("instance_id","nom");--> statement-breakpoint
CREATE UNIQUE INDEX "salesnav_modeles_defaut_idx" ON "salesnav_modeles" USING btree ("instance_id","icp","etape") WHERE campagne_id is null;--> statement-breakpoint
CREATE UNIQUE INDEX "salesnav_modeles_campagne_idx" ON "salesnav_modeles" USING btree ("campagne_id","etape") WHERE campagne_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "salesnav_reglages_instance_idx" ON "salesnav_reglages" USING btree ("instance_id");--> statement-breakpoint
CREATE POLICY "salesnav_campagnes_instance_isolation" ON "salesnav_campagnes" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "salesnav_modeles_instance_isolation" ON "salesnav_modeles" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "salesnav_reglages_instance_isolation" ON "salesnav_reglages" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);