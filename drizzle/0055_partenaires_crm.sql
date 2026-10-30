CREATE TABLE "crm_partages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"partenaire_id" uuid NOT NULL,
	"objet" text NOT NULL,
	"local_id" uuid,
	"ref" text NOT NULL,
	"etat" jsonb NOT NULL,
	"detache_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "crm_partages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "messages_partenaires" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"partenaire_id" uuid NOT NULL,
	"sens" text NOT NULL,
	"type" text NOT NULL,
	"sujet" text NOT NULL,
	"texte" text NOT NULL,
	"en_reponse_a" text,
	"simulation" boolean DEFAULT false NOT NULL,
	"proposition_id" uuid,
	"envoye_par" text
);
--> statement-breakpoint
ALTER TABLE "messages_partenaires" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "missions" ADD COLUMN "context_id" text;--> statement-breakpoint
ALTER TABLE "missions" ADD COLUMN "niveau" text;--> statement-breakpoint
ALTER TABLE "partenaires" ADD COLUMN "voit" jsonb DEFAULT '{"objets":["entreprise","contact","affaire","tache","rendez_vous","activite"],"champsExclus":[],"qualification":false}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "partenaires" ADD COLUMN "instantane_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "partenaires" ADD COLUMN "synchro_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "partenaires" ADD COLUMN "passe_complete_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "crm_partages" ADD CONSTRAINT "crm_partages_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_partages" ADD CONSTRAINT "crm_partages_partenaire_id_partenaires_id_fk" FOREIGN KEY ("partenaire_id") REFERENCES "public"."partenaires"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages_partenaires" ADD CONSTRAINT "messages_partenaires_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages_partenaires" ADD CONSTRAINT "messages_partenaires_partenaire_id_partenaires_id_fk" FOREIGN KEY ("partenaire_id") REFERENCES "public"."partenaires"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages_partenaires" ADD CONSTRAINT "messages_partenaires_proposition_id_propositions_id_fk" FOREIGN KEY ("proposition_id") REFERENCES "public"."propositions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "crm_partages_ref_idx" ON "crm_partages" USING btree ("instance_id","partenaire_id","ref");--> statement-breakpoint
CREATE INDEX "crm_partages_local_idx" ON "crm_partages" USING btree ("instance_id","partenaire_id","objet","local_id");--> statement-breakpoint
CREATE INDEX "messages_partenaires_idx" ON "messages_partenaires" USING btree ("instance_id","partenaire_id");--> statement-breakpoint
CREATE POLICY "crm_partages_instance_isolation" ON "crm_partages" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "messages_partenaires_instance_isolation" ON "messages_partenaires" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);--> statement-breakpoint
-- The partner sync (src/partenaires/synchro.ts) reads the CRM records changed since its last pass:
-- updated_at must move on every change, whatever code path made it. A path that sets updated_at
-- itself keeps its value.
CREATE FUNCTION "crm_touch_updated_at"() RETURNS trigger AS $$
BEGIN
  IF NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at AND NEW IS DISTINCT FROM OLD THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
-- A link added, moved or removed changes the record it belongs to (TG_ARGV: parent table, column).
CREATE FUNCTION "crm_touch_parent"() RETURNS trigger AS $$
DECLARE
  avant uuid;
  apres uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN avant := (to_jsonb(OLD) ->> TG_ARGV[1])::uuid; END IF;
  IF TG_OP <> 'DELETE' THEN apres := (to_jsonb(NEW) ->> TG_ARGV[1])::uuid; END IF;
  EXECUTE format('UPDATE %I SET updated_at = now() WHERE id IN ($1, $2) AND updated_at < now()', TG_ARGV[0])
    USING avant, apres;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "entreprises_touch_trg" BEFORE UPDATE ON "entreprises" FOR EACH ROW EXECUTE FUNCTION "crm_touch_updated_at"();--> statement-breakpoint
CREATE TRIGGER "contacts_touch_trg" BEFORE UPDATE ON "contacts" FOR EACH ROW EXECUTE FUNCTION "crm_touch_updated_at"();--> statement-breakpoint
CREATE TRIGGER "opportunites_touch_trg" BEFORE UPDATE ON "opportunites" FOR EACH ROW EXECUTE FUNCTION "crm_touch_updated_at"();--> statement-breakpoint
CREATE TRIGGER "taches_touch_trg" BEFORE UPDATE ON "taches" FOR EACH ROW EXECUTE FUNCTION "crm_touch_updated_at"();--> statement-breakpoint
CREATE TRIGGER "rendez_vous_touch_trg" BEFORE UPDATE ON "rendez_vous" FOR EACH ROW EXECUTE FUNCTION "crm_touch_updated_at"();--> statement-breakpoint
CREATE TRIGGER "activites_touch_trg" BEFORE UPDATE ON "activites" FOR EACH ROW EXECUTE FUNCTION "crm_touch_updated_at"();--> statement-breakpoint
CREATE TRIGGER "affaire_contacts_touch_trg" BEFORE UPDATE ON "affaire_contacts" FOR EACH ROW EXECUTE FUNCTION "crm_touch_updated_at"();--> statement-breakpoint
CREATE TRIGGER "affaire_entreprises_touch_trg" BEFORE UPDATE ON "affaire_entreprises" FOR EACH ROW EXECUTE FUNCTION "crm_touch_updated_at"();--> statement-breakpoint
CREATE TRIGGER "contact_entreprises_touch_trg" BEFORE UPDATE ON "contact_entreprises" FOR EACH ROW EXECUTE FUNCTION "crm_touch_updated_at"();--> statement-breakpoint
CREATE TRIGGER "contact_emails_touch_trg" BEFORE UPDATE ON "contact_emails" FOR EACH ROW EXECUTE FUNCTION "crm_touch_updated_at"();--> statement-breakpoint
CREATE TRIGGER "rdv_contacts_touch_trg" BEFORE UPDATE ON "rdv_contacts" FOR EACH ROW EXECUTE FUNCTION "crm_touch_updated_at"();--> statement-breakpoint
CREATE TRIGGER "rdv_entreprises_touch_trg" BEFORE UPDATE ON "rdv_entreprises" FOR EACH ROW EXECUTE FUNCTION "crm_touch_updated_at"();--> statement-breakpoint
CREATE TRIGGER "rdv_affaires_touch_trg" BEFORE UPDATE ON "rdv_affaires" FOR EACH ROW EXECUTE FUNCTION "crm_touch_updated_at"();--> statement-breakpoint
CREATE TRIGGER "affaire_contacts_parent_trg" AFTER INSERT OR UPDATE OR DELETE ON "affaire_contacts" FOR EACH ROW EXECUTE FUNCTION "crm_touch_parent"('opportunites', 'opportunite_id');--> statement-breakpoint
CREATE TRIGGER "affaire_entreprises_parent_trg" AFTER INSERT OR UPDATE OR DELETE ON "affaire_entreprises" FOR EACH ROW EXECUTE FUNCTION "crm_touch_parent"('opportunites', 'opportunite_id');--> statement-breakpoint
CREATE TRIGGER "contact_entreprises_parent_trg" AFTER INSERT OR UPDATE OR DELETE ON "contact_entreprises" FOR EACH ROW EXECUTE FUNCTION "crm_touch_parent"('contacts', 'contact_id');--> statement-breakpoint
CREATE TRIGGER "contact_emails_parent_trg" AFTER INSERT OR UPDATE OR DELETE ON "contact_emails" FOR EACH ROW EXECUTE FUNCTION "crm_touch_parent"('contacts', 'contact_id');--> statement-breakpoint
CREATE TRIGGER "rdv_contacts_parent_trg" AFTER INSERT OR UPDATE OR DELETE ON "rdv_contacts" FOR EACH ROW EXECUTE FUNCTION "crm_touch_parent"('rendez_vous', 'rendez_vous_id');--> statement-breakpoint
CREATE TRIGGER "rdv_entreprises_parent_trg" AFTER INSERT OR UPDATE OR DELETE ON "rdv_entreprises" FOR EACH ROW EXECUTE FUNCTION "crm_touch_parent"('rendez_vous', 'rendez_vous_id');--> statement-breakpoint
CREATE TRIGGER "rdv_affaires_parent_trg" AFTER INSERT OR UPDATE OR DELETE ON "rdv_affaires" FOR EACH ROW EXECUTE FUNCTION "crm_touch_parent"('rendez_vous', 'rendez_vous_id');
