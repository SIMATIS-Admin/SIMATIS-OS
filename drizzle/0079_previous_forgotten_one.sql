CREATE TABLE "recherche_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"mode" text NOT NULL,
	"nombre_vise" integer NOT NULL,
	"trouves" integer DEFAULT 0 NOT NULL,
	"ajoutees" integer,
	"rapprochees" integer,
	"etat" text DEFAULT 'en_cours' NOT NULL,
	"erreur" text,
	"fini_le" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "recherche_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "recherche_sessions" ADD CONSTRAINT "recherche_sessions_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recherche_sessions_instance_idx" ON "recherche_sessions" USING btree ("instance_id","created_at");--> statement-breakpoint
CREATE POLICY "recherche_sessions_instance_isolation" ON "recherche_sessions" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);