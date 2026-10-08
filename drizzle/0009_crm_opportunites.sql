CREATE TABLE "activites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"type" text NOT NULL,
	"contact_id" uuid,
	"at" timestamp with time zone NOT NULL,
	"resume" text
);
--> statement-breakpoint
ALTER TABLE "activites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "opportunites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"entreprise_id" uuid,
	"contact_id" uuid,
	"titre" text NOT NULL,
	"etape" text NOT NULL,
	"montant" integer,
	"echeance" date,
	"clos" text,
	"motif" text,
	"proprietaire" text,
	"origine" text,
	"qualification" jsonb,
	"potentiel" text,
	"faisabilite" text,
	"prochaine_etape" text
);
--> statement-breakpoint
ALTER TABLE "opportunites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "taches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opportunite_id" uuid,
	"contact_id" uuid,
	"titre" text NOT NULL,
	"canal" text NOT NULL,
	"echeance" timestamp with time zone,
	"fait_at" timestamp with time zone,
	"prepare" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "taches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "activites" ADD CONSTRAINT "activites_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activites" ADD CONSTRAINT "activites_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunites" ADD CONSTRAINT "opportunites_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunites" ADD CONSTRAINT "opportunites_entreprise_id_entreprises_id_fk" FOREIGN KEY ("entreprise_id") REFERENCES "public"."entreprises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunites" ADD CONSTRAINT "opportunites_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taches" ADD CONSTRAINT "taches_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taches" ADD CONSTRAINT "taches_opportunite_id_opportunites_id_fk" FOREIGN KEY ("opportunite_id") REFERENCES "public"."opportunites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taches" ADD CONSTRAINT "taches_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activites_instance_at_idx" ON "activites" USING btree ("instance_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "activites_source_idx" ON "activites" USING btree ("instance_id","source","source_id");--> statement-breakpoint
CREATE INDEX "opportunites_instance_idx" ON "opportunites" USING btree ("instance_id");--> statement-breakpoint
CREATE UNIQUE INDEX "opportunites_source_idx" ON "opportunites" USING btree ("instance_id","source","source_id");--> statement-breakpoint
CREATE INDEX "taches_instance_echeance_idx" ON "taches" USING btree ("instance_id","echeance");--> statement-breakpoint
CREATE UNIQUE INDEX "taches_source_idx" ON "taches" USING btree ("instance_id","source","source_id");--> statement-breakpoint
CREATE POLICY "activites_instance_isolation" ON "activites" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "opportunites_instance_isolation" ON "opportunites" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "taches_instance_isolation" ON "taches" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);