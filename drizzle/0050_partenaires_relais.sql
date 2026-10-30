CREATE TABLE "donnees_envoyees" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"partenaire_id" uuid NOT NULL,
	"objet" text NOT NULL,
	"evenement" text NOT NULL,
	"ref" text NOT NULL,
	"champs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"proposition_id" uuid,
	"envoyee_par" text
);
--> statement-breakpoint
ALTER TABLE "donnees_envoyees" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "missions" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"partenaire_id" uuid NOT NULL,
	"sens" text NOT NULL,
	"titre" text NOT NULL,
	"consigne" text NOT NULL,
	"contexte" jsonb,
	"etat" text NOT NULL,
	"dernier_message" text,
	"resultat" jsonb,
	"historique" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"proposition_id" uuid,
	"confiee_par" text
);
--> statement-breakpoint
ALTER TABLE "missions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "partenaires" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"connexion_id" text NOT NULL,
	"noeud_id" text NOT NULL,
	"nom" text NOT NULL,
	"carte" jsonb,
	"niveau" text DEFAULT 'L0' NOT NULL,
	"partage" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"statut" text DEFAULT 'active' NOT NULL,
	"coupee_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "partenaires" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "relais_sorties" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"connexion_id" text NOT NULL,
	"type" text NOT NULL,
	"corps" jsonb NOT NULL,
	"cree_le" timestamp with time zone NOT NULL,
	"prochain_essai" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "relais_sorties" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "relais_vus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"enveloppe_id" text NOT NULL,
	"vu_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "relais_vus" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "donnees_envoyees" ADD CONSTRAINT "donnees_envoyees_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donnees_envoyees" ADD CONSTRAINT "donnees_envoyees_partenaire_id_partenaires_id_fk" FOREIGN KEY ("partenaire_id") REFERENCES "public"."partenaires"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donnees_envoyees" ADD CONSTRAINT "donnees_envoyees_proposition_id_propositions_id_fk" FOREIGN KEY ("proposition_id") REFERENCES "public"."propositions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_partenaire_id_partenaires_id_fk" FOREIGN KEY ("partenaire_id") REFERENCES "public"."partenaires"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_proposition_id_propositions_id_fk" FOREIGN KEY ("proposition_id") REFERENCES "public"."propositions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partenaires" ADD CONSTRAINT "partenaires_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relais_sorties" ADD CONSTRAINT "relais_sorties_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relais_vus" ADD CONSTRAINT "relais_vus_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "missions_partenaire_idx" ON "missions" USING btree ("instance_id","partenaire_id");--> statement-breakpoint
CREATE UNIQUE INDEX "partenaires_connexion_idx" ON "partenaires" USING btree ("instance_id","connexion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "relais_vus_enveloppe_idx" ON "relais_vus" USING btree ("instance_id","enveloppe_id");--> statement-breakpoint
CREATE POLICY "donnees_envoyees_instance_isolation" ON "donnees_envoyees" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "missions_instance_isolation" ON "missions" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "partenaires_instance_isolation" ON "partenaires" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "relais_sorties_instance_isolation" ON "relais_sorties" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "relais_vus_instance_isolation" ON "relais_vus" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);