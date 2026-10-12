CREATE TABLE "sujets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"type" text NOT NULL,
	"titre" text NOT NULL,
	"resume" text,
	"origine" text NOT NULL,
	"lien" text,
	"echeance" timestamp with time zone,
	"contact_id" uuid,
	"entreprise_id" uuid,
	"proposition_id" uuid,
	"statut" text DEFAULT 'a_traiter' NOT NULL,
	"tache_id" uuid,
	"traite_at" timestamp with time zone,
	"traite_par" text,
	"reporte_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sujets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sujets" ADD CONSTRAINT "sujets_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sujets" ADD CONSTRAINT "sujets_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sujets" ADD CONSTRAINT "sujets_entreprise_id_entreprises_id_fk" FOREIGN KEY ("entreprise_id") REFERENCES "public"."entreprises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sujets" ADD CONSTRAINT "sujets_proposition_id_propositions_id_fk" FOREIGN KEY ("proposition_id") REFERENCES "public"."propositions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sujets" ADD CONSTRAINT "sujets_tache_id_taches_id_fk" FOREIGN KEY ("tache_id") REFERENCES "public"."taches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sujets_instance_statut_idx" ON "sujets" USING btree ("instance_id","statut");--> statement-breakpoint
CREATE UNIQUE INDEX "sujets_source_idx" ON "sujets" USING btree ("instance_id","source","source_id");--> statement-breakpoint
CREATE POLICY "sujets_instance_isolation" ON "sujets" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);--> statement-breakpoint
-- Pending proposals become "à valider" subjects of the Inbox.
INSERT INTO "sujets" ("instance_id", "source", "source_id", "type", "titre", "origine", "contact_id", "proposition_id", "created_at")
SELECT p."instance_id", 'os', p."id"::text, 'a_valider',
  coalesce(p."contenu"->>'objet', p."contenu"->>'titre', 'Transmettre le devis ' || (p."contenu"->>'numero'), p."type"),
  'os', c."id", p."id", p."created_at"
FROM "propositions" p
LEFT JOIN "contacts" c ON c."id"::text = p."contenu"->>'contactId' AND c."instance_id" = p."instance_id"
WHERE p."statut" = 'proposee';
