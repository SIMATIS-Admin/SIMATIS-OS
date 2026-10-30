CREATE TABLE "prospection_occurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"mode" text NOT NULL,
	"contact_id" uuid,
	"contact_nom" text NOT NULL,
	"societe" text,
	"theme" text NOT NULL,
	"touche" integer DEFAULT 1 NOT NULL,
	"etat" text NOT NULL,
	"thread_id" text,
	"envoye_at" timestamp with time zone,
	"lot" text
);
--> statement-breakpoint
ALTER TABLE "prospection_occurrences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "prospection_reglages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"objectif_jour" integer DEFAULT 30 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prospection_reglages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "prospection_signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"nom" text NOT NULL,
	"defaut" boolean DEFAULT false NOT NULL,
	"type_mime" text NOT NULL,
	"image" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prospection_signatures" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prospection_occurrences" ADD CONSTRAINT "prospection_occurrences_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospection_occurrences" ADD CONSTRAINT "prospection_occurrences_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospection_reglages" ADD CONSTRAINT "prospection_reglages_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospection_signatures" ADD CONSTRAINT "prospection_signatures_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prospection_occurrences_instance_idx" ON "prospection_occurrences" USING btree ("instance_id","envoye_at");--> statement-breakpoint
CREATE UNIQUE INDEX "prospection_reglages_instance_idx" ON "prospection_reglages" USING btree ("instance_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prospection_signatures_nom_idx" ON "prospection_signatures" USING btree ("instance_id","nom");--> statement-breakpoint
CREATE POLICY "prospection_occurrences_instance_isolation" ON "prospection_occurrences" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "prospection_reglages_instance_isolation" ON "prospection_reglages" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "prospection_signatures_instance_isolation" ON "prospection_signatures" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);