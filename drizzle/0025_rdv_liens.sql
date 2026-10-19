CREATE TABLE "rdv_liens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" text NOT NULL,
	"contact_id" uuid,
	"entreprise_id" uuid
);
--> statement-breakpoint
ALTER TABLE "rdv_liens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "taches" ADD COLUMN "entreprise_id" uuid;--> statement-breakpoint
ALTER TABLE "taches" ADD COLUMN "lien_choisi" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "rdv_liens" ADD CONSTRAINT "rdv_liens_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rdv_liens" ADD CONSTRAINT "rdv_liens_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rdv_liens" ADD CONSTRAINT "rdv_liens_entreprise_id_entreprises_id_fk" FOREIGN KEY ("entreprise_id") REFERENCES "public"."entreprises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rdv_liens_event_idx" ON "rdv_liens" USING btree ("instance_id","event_id");--> statement-breakpoint
ALTER TABLE "taches" ADD CONSTRAINT "taches_entreprise_id_entreprises_id_fk" FOREIGN KEY ("entreprise_id") REFERENCES "public"."entreprises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "rdv_liens_instance_isolation" ON "rdv_liens" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);