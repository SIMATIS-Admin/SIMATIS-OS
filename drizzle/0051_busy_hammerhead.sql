CREATE TABLE "prospection_brouillons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"campagne_id" uuid NOT NULL,
	"tache_id" uuid,
	"contact_id" uuid,
	"contact_nom" text NOT NULL,
	"contact_email" text NOT NULL,
	"societe" text,
	"touche" integer DEFAULT 2 NOT NULL,
	"etat" text DEFAULT 'a_rediger' NOT NULL,
	"objet" text,
	"corps" text,
	"note" text,
	"thread_id" text,
	"suivi_type" text DEFAULT 'delai' NOT NULL,
	"suivi_date" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "prospection_brouillons" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "prospection_campagnes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"mode" text NOT NULL,
	"statut" text DEFAULT 'redaction' NOT NULL,
	"reglage" jsonb NOT NULL,
	"erreur" text,
	"demande_at" timestamp with time zone DEFAULT now() NOT NULL,
	"demarre_at" timestamp with time zone,
	"termine_at" timestamp with time zone,
	"resultat" jsonb
);
--> statement-breakpoint
ALTER TABLE "prospection_campagnes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prospection_brouillons" ADD CONSTRAINT "prospection_brouillons_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospection_brouillons" ADD CONSTRAINT "prospection_brouillons_campagne_id_prospection_campagnes_id_fk" FOREIGN KEY ("campagne_id") REFERENCES "public"."prospection_campagnes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospection_brouillons" ADD CONSTRAINT "prospection_brouillons_tache_id_taches_id_fk" FOREIGN KEY ("tache_id") REFERENCES "public"."taches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospection_brouillons" ADD CONSTRAINT "prospection_brouillons_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospection_campagnes" ADD CONSTRAINT "prospection_campagnes_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prospection_brouillons_campagne_idx" ON "prospection_brouillons" USING btree ("campagne_id");--> statement-breakpoint
CREATE INDEX "prospection_campagnes_instance_idx" ON "prospection_campagnes" USING btree ("instance_id","statut");--> statement-breakpoint
CREATE POLICY "prospection_brouillons_instance_isolation" ON "prospection_brouillons" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "prospection_campagnes_instance_isolation" ON "prospection_campagnes" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);