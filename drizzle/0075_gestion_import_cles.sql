CREATE TABLE "gestion_import_cles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cle" text NOT NULL,
	"decision" text NOT NULL,
	"cible_type" text,
	"cible_id" uuid
);
--> statement-breakpoint
ALTER TABLE "gestion_import_cles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gestion_import_cles" ADD CONSTRAINT "gestion_import_cles_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gestion_import_cles_idx" ON "gestion_import_cles" USING btree ("instance_id","cle");--> statement-breakpoint
CREATE POLICY "gestion_import_cles_instance_isolation" ON "gestion_import_cles" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);