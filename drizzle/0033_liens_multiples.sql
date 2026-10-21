CREATE TABLE "affaire_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opportunite_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"principal" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "affaire_contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "affaire_entreprises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opportunite_id" uuid NOT NULL,
	"entreprise_id" uuid NOT NULL,
	"principal" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "affaire_entreprises" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "contact_entreprises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"contact_id" uuid NOT NULL,
	"entreprise_id" uuid NOT NULL,
	"principal" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact_entreprises" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "affaire_contacts" ADD CONSTRAINT "affaire_contacts_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affaire_contacts" ADD CONSTRAINT "affaire_contacts_opportunite_id_opportunites_id_fk" FOREIGN KEY ("opportunite_id") REFERENCES "public"."opportunites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affaire_contacts" ADD CONSTRAINT "affaire_contacts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affaire_entreprises" ADD CONSTRAINT "affaire_entreprises_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affaire_entreprises" ADD CONSTRAINT "affaire_entreprises_opportunite_id_opportunites_id_fk" FOREIGN KEY ("opportunite_id") REFERENCES "public"."opportunites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "affaire_entreprises" ADD CONSTRAINT "affaire_entreprises_entreprise_id_entreprises_id_fk" FOREIGN KEY ("entreprise_id") REFERENCES "public"."entreprises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_entreprises" ADD CONSTRAINT "contact_entreprises_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_entreprises" ADD CONSTRAINT "contact_entreprises_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_entreprises" ADD CONSTRAINT "contact_entreprises_entreprise_id_entreprises_id_fk" FOREIGN KEY ("entreprise_id") REFERENCES "public"."entreprises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "affaire_contacts_paire_idx" ON "affaire_contacts" USING btree ("instance_id","opportunite_id","contact_id");--> statement-breakpoint
CREATE INDEX "affaire_contacts_contact_idx" ON "affaire_contacts" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "affaire_entreprises_paire_idx" ON "affaire_entreprises" USING btree ("instance_id","opportunite_id","entreprise_id");--> statement-breakpoint
CREATE INDEX "affaire_entreprises_entreprise_idx" ON "affaire_entreprises" USING btree ("entreprise_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_entreprises_paire_idx" ON "contact_entreprises" USING btree ("instance_id","contact_id","entreprise_id");--> statement-breakpoint
CREATE INDEX "contact_entreprises_entreprise_idx" ON "contact_entreprises" USING btree ("entreprise_id");--> statement-breakpoint
CREATE POLICY "affaire_contacts_instance_isolation" ON "affaire_contacts" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "affaire_entreprises_instance_isolation" ON "affaire_entreprises" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "contact_entreprises_instance_isolation" ON "contact_entreprises" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);--> statement-breakpoint
INSERT INTO "affaire_contacts" ("instance_id", "source", "opportunite_id", "contact_id", "principal")
SELECT "instance_id", "source", "id", "contact_id", true FROM "opportunites" WHERE "contact_id" IS NOT NULL;
--> statement-breakpoint
INSERT INTO "affaire_entreprises" ("instance_id", "source", "opportunite_id", "entreprise_id", "principal")
SELECT "instance_id", "source", "id", "entreprise_id", true FROM "opportunites" WHERE "entreprise_id" IS NOT NULL;
--> statement-breakpoint
INSERT INTO "contact_entreprises" ("instance_id", "source", "contact_id", "entreprise_id", "principal")
SELECT "instance_id", "source", "id", "entreprise_id", true FROM "contacts" WHERE "entreprise_id" IS NOT NULL;
