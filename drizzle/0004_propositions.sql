CREATE TABLE "autonomie" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"action" text NOT NULL,
	"niveau" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "autonomie" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "propositions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"type" text NOT NULL,
	"contenu" jsonb NOT NULL,
	"auteur" text NOT NULL,
	"statut" text DEFAULT 'proposee' NOT NULL,
	"niveau" text NOT NULL,
	"decide_par" text,
	"decide_at" timestamp with time zone,
	"resultat" jsonb
);
--> statement-breakpoint
ALTER TABLE "propositions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "autonomie" ADD CONSTRAINT "autonomie_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "propositions" ADD CONSTRAINT "propositions_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "autonomie_instance_action_idx" ON "autonomie" USING btree ("instance_id","action");--> statement-breakpoint
CREATE INDEX "propositions_instance_statut_idx" ON "propositions" USING btree ("instance_id","statut");--> statement-breakpoint
CREATE POLICY "autonomie_instance_isolation" ON "autonomie" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "propositions_instance_isolation" ON "propositions" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);