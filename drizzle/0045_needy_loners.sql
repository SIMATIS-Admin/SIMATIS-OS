CREATE TABLE "ateliers_strategie" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"entreprise_id" uuid NOT NULL,
	"titre" text NOT NULL,
	"etape" integer DEFAULT 1 NOT NULL,
	"etape_max" integer DEFAULT 1 NOT NULL,
	"etat" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ateliers_strategie" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ateliers_strategie" ADD CONSTRAINT "ateliers_strategie_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ateliers_strategie" ADD CONSTRAINT "ateliers_strategie_entreprise_id_entreprises_id_fk" FOREIGN KEY ("entreprise_id") REFERENCES "public"."entreprises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ateliers_strategie_instance_idx" ON "ateliers_strategie" USING btree ("instance_id");--> statement-breakpoint
CREATE POLICY "ateliers_strategie_instance_isolation" ON "ateliers_strategie" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);