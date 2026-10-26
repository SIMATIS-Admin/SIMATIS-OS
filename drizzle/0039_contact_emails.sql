CREATE TABLE "contact_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"contact_id" uuid NOT NULL,
	"email" text NOT NULL,
	"principal" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact_emails" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contact_emails" ADD CONSTRAINT "contact_emails_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_emails" ADD CONSTRAINT "contact_emails_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_emails_paire_idx" ON "contact_emails" USING btree ("instance_id","contact_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_emails_principal_idx" ON "contact_emails" USING btree ("contact_id") WHERE "contact_emails"."principal";--> statement-breakpoint
CREATE INDEX "contact_emails_email_idx" ON "contact_emails" USING btree ("instance_id","email");--> statement-breakpoint
CREATE POLICY "contact_emails_instance_isolation" ON "contact_emails" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);--> statement-breakpoint
INSERT INTO "contact_emails" ("instance_id", "contact_id", "email", "principal")
SELECT "instance_id", "id", lower(btrim("email")), true FROM "contacts" WHERE btrim(coalesce("email", '')) <> '' ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- contacts.email (written by the sync, the sheets, the API) stays the primary address: this keeps
-- the matching contact_emails row primary whatever code path changed it.
CREATE FUNCTION "contacts_sync_primary_email"() RETURNS trigger AS $$
DECLARE
  e text := lower(btrim(coalesce(NEW.email, '')));
BEGIN
  UPDATE "contact_emails" SET "principal" = false
    WHERE "contact_id" = NEW.id AND "principal" AND "email" <> e;
  IF e <> '' THEN
    INSERT INTO "contact_emails" ("instance_id", "contact_id", "email", "principal")
      VALUES (NEW.instance_id, NEW.id, e, true)
      ON CONFLICT ("instance_id", "contact_id", "email") DO UPDATE SET "principal" = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "contacts_sync_primary_email_trg"
  AFTER INSERT OR UPDATE OF "email" ON "contacts"
  FOR EACH ROW EXECUTE FUNCTION "contacts_sync_primary_email"();
