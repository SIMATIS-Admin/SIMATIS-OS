CREATE TABLE "executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"routine" text NOT NULL,
	"statut" text DEFAULT 'demandee' NOT NULL,
	"demande_par" text NOT NULL,
	"debut" timestamp with time zone,
	"fin" timestamp with time zone,
	"etapes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rapport" jsonb
);
--> statement-breakpoint
ALTER TABLE "executions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "routines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cle" text NOT NULL,
	"actif" boolean DEFAULT true NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"skill" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "routines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "jetons" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "executions_instance_idx" ON "executions" USING btree ("instance_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "executions_ouverte_idx" ON "executions" USING btree ("instance_id","routine") WHERE statut in ('demandee', 'en_cours');--> statement-breakpoint
CREATE UNIQUE INDEX "routines_cle_idx" ON "routines" USING btree ("instance_id","cle");--> statement-breakpoint
CREATE POLICY "executions_instance_isolation" ON "executions" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "routines_instance_isolation" ON "routines" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);