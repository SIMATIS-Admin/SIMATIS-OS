CREATE TABLE "prospection_suivi_froid" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"base_id" uuid NOT NULL,
	"touches" integer DEFAULT 0 NOT NULL,
	"touches_max" integer DEFAULT 4 NOT NULL,
	"derniere_le" timestamp with time zone,
	"statut" text DEFAULT 'actif' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prospection_suivi_froid" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prospection_brouillons" ADD COLUMN "base_id" uuid;--> statement-breakpoint
ALTER TABLE "prospection_occurrences" ADD COLUMN "base_id" uuid;--> statement-breakpoint
ALTER TABLE "prospection_suivi_froid" ADD CONSTRAINT "prospection_suivi_froid_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospection_suivi_froid" ADD CONSTRAINT "prospection_suivi_froid_base_id_base_vivante_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."base_vivante"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prospection_suivi_froid_base_idx" ON "prospection_suivi_froid" USING btree ("instance_id","base_id");--> statement-breakpoint
ALTER TABLE "prospection_brouillons" ADD CONSTRAINT "prospection_brouillons_base_id_base_vivante_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."base_vivante"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospection_occurrences" ADD CONSTRAINT "prospection_occurrences_base_id_base_vivante_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."base_vivante"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "prospection_suivi_froid_instance_isolation" ON "prospection_suivi_froid" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);