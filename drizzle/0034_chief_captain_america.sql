CREATE TABLE "rdv_affaires" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rendez_vous_id" uuid NOT NULL,
	"opportunite_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rdv_affaires" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rdv_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rendez_vous_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rdv_contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rdv_entreprises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rendez_vous_id" uuid NOT NULL,
	"entreprise_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rdv_entreprises" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rendez_vous" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" text NOT NULL,
	"titre" text DEFAULT '' NOT NULL,
	"debut" timestamp with time zone,
	"fin" timestamp with time zone,
	"lieu" text,
	"statut" text DEFAULT 'a_trier' NOT NULL,
	"compte_rendu" text,
	"compte_rendu_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "rendez_vous" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rdv_affaires" ADD CONSTRAINT "rdv_affaires_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rdv_affaires" ADD CONSTRAINT "rdv_affaires_rendez_vous_id_rendez_vous_id_fk" FOREIGN KEY ("rendez_vous_id") REFERENCES "public"."rendez_vous"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rdv_affaires" ADD CONSTRAINT "rdv_affaires_opportunite_id_opportunites_id_fk" FOREIGN KEY ("opportunite_id") REFERENCES "public"."opportunites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rdv_contacts" ADD CONSTRAINT "rdv_contacts_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rdv_contacts" ADD CONSTRAINT "rdv_contacts_rendez_vous_id_rendez_vous_id_fk" FOREIGN KEY ("rendez_vous_id") REFERENCES "public"."rendez_vous"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rdv_contacts" ADD CONSTRAINT "rdv_contacts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rdv_entreprises" ADD CONSTRAINT "rdv_entreprises_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rdv_entreprises" ADD CONSTRAINT "rdv_entreprises_rendez_vous_id_rendez_vous_id_fk" FOREIGN KEY ("rendez_vous_id") REFERENCES "public"."rendez_vous"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rdv_entreprises" ADD CONSTRAINT "rdv_entreprises_entreprise_id_entreprises_id_fk" FOREIGN KEY ("entreprise_id") REFERENCES "public"."entreprises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rendez_vous" ADD CONSTRAINT "rendez_vous_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rdv_affaires_paire_idx" ON "rdv_affaires" USING btree ("instance_id","rendez_vous_id","opportunite_id");--> statement-breakpoint
CREATE INDEX "rdv_affaires_affaire_idx" ON "rdv_affaires" USING btree ("opportunite_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rdv_contacts_paire_idx" ON "rdv_contacts" USING btree ("instance_id","rendez_vous_id","contact_id");--> statement-breakpoint
CREATE INDEX "rdv_contacts_contact_idx" ON "rdv_contacts" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rdv_entreprises_paire_idx" ON "rdv_entreprises" USING btree ("instance_id","rendez_vous_id","entreprise_id");--> statement-breakpoint
CREATE INDEX "rdv_entreprises_entreprise_idx" ON "rdv_entreprises" USING btree ("entreprise_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rendez_vous_event_idx" ON "rendez_vous" USING btree ("instance_id","event_id");--> statement-breakpoint
CREATE POLICY "rdv_affaires_instance_isolation" ON "rdv_affaires" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "rdv_contacts_instance_isolation" ON "rdv_contacts" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "rdv_entreprises_instance_isolation" ON "rdv_entreprises" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "rendez_vous_instance_isolation" ON "rendez_vous" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);--> statement-breakpoint
INSERT INTO "rendez_vous" ("instance_id", "event_id", "statut")
SELECT "instance_id", "event_id", 'rdv' FROM "rdv_liens"
ON CONFLICT ("instance_id", "event_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "rendez_vous" ("instance_id", "event_id", "statut", "compte_rendu", "compte_rendu_at")
SELECT "instance_id", "source_id", 'rdv', "resume", "at" FROM "activites"
WHERE "source" = 'rdv' AND "source_id" IS NOT NULL
ON CONFLICT ("instance_id", "event_id") DO UPDATE SET "statut" = 'rdv', "compte_rendu" = EXCLUDED."compte_rendu", "compte_rendu_at" = EXCLUDED."compte_rendu_at";
--> statement-breakpoint
INSERT INTO "rdv_contacts" ("instance_id", "rendez_vous_id", "contact_id")
SELECT l."instance_id", r."id", l."contact_id" FROM "rdv_liens" l
JOIN "rendez_vous" r ON r."instance_id" = l."instance_id" AND r."event_id" = l."event_id"
WHERE l."contact_id" IS NOT NULL;
--> statement-breakpoint
INSERT INTO "rdv_entreprises" ("instance_id", "rendez_vous_id", "entreprise_id")
SELECT l."instance_id", r."id", l."entreprise_id" FROM "rdv_liens" l
JOIN "rendez_vous" r ON r."instance_id" = l."instance_id" AND r."event_id" = l."event_id"
WHERE l."entreprise_id" IS NOT NULL;
