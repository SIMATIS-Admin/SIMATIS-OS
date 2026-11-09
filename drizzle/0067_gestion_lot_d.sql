CREATE TABLE "gestion_cca_mouvements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"date" date NOT NULL,
	"type" text NOT NULL,
	"libelle" text NOT NULL,
	"montant_cents" integer NOT NULL,
	"etat" text DEFAULT 'prevu' NOT NULL,
	"ref_source" text,
	"archivee_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "gestion_cca_mouvements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "gestion_ik_baremes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"annee" integer NOT NULL,
	"categorie" text NOT NULL,
	"version" integer NOT NULL,
	"tranches" jsonb NOT NULL,
	"valide_le" date
);
--> statement-breakpoint
ALTER TABLE "gestion_ik_baremes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "gestion_ik_lieux" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"nom" text NOT NULL,
	"distance_km" integer NOT NULL,
	"origine" text DEFAULT 'saisie' NOT NULL,
	"archivee_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "gestion_ik_lieux" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "gestion_ik_mois" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"mois" text NOT NULL,
	"abonnement" boolean NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gestion_ik_mois" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "gestion_ik_trajets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"vehicule_id" uuid NOT NULL,
	"date" date NOT NULL,
	"trajet" text NOT NULL,
	"commentaire" text NOT NULL,
	"km_aller_retour" integer NOT NULL,
	"origine_distance" text DEFAULT 'saisie' NOT NULL,
	"mandat" text,
	"justificatif" text,
	"statut" text DEFAULT 'brouillon' NOT NULL,
	"archivee_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "gestion_ik_trajets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "gestion_ik_vehicules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"libelle" text NOT NULL,
	"categorie" text NOT NULL,
	"puissance_fiscale" integer,
	"archivee_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "gestion_ik_vehicules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gestion_cca_mouvements" ADD CONSTRAINT "gestion_cca_mouvements_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion_ik_baremes" ADD CONSTRAINT "gestion_ik_baremes_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion_ik_lieux" ADD CONSTRAINT "gestion_ik_lieux_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion_ik_mois" ADD CONSTRAINT "gestion_ik_mois_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion_ik_trajets" ADD CONSTRAINT "gestion_ik_trajets_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion_ik_trajets" ADD CONSTRAINT "gestion_ik_trajets_vehicule_id_gestion_ik_vehicules_id_fk" FOREIGN KEY ("vehicule_id") REFERENCES "public"."gestion_ik_vehicules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion_ik_vehicules" ADD CONSTRAINT "gestion_ik_vehicules_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gestion_cca_ref_idx" ON "gestion_cca_mouvements" USING btree ("instance_id","ref_source");--> statement-breakpoint
CREATE UNIQUE INDEX "gestion_ik_baremes_version_idx" ON "gestion_ik_baremes" USING btree ("instance_id","annee","categorie","version");--> statement-breakpoint
CREATE UNIQUE INDEX "gestion_ik_mois_idx" ON "gestion_ik_mois" USING btree ("instance_id","mois");--> statement-breakpoint
CREATE INDEX "gestion_ik_trajets_idx" ON "gestion_ik_trajets" USING btree ("instance_id","date");--> statement-breakpoint
CREATE POLICY "gestion_cca_mouvements_instance_isolation" ON "gestion_cca_mouvements" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "gestion_ik_baremes_instance_isolation" ON "gestion_ik_baremes" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "gestion_ik_lieux_instance_isolation" ON "gestion_ik_lieux" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "gestion_ik_mois_instance_isolation" ON "gestion_ik_mois" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "gestion_ik_trajets_instance_isolation" ON "gestion_ik_trajets" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "gestion_ik_vehicules_instance_isolation" ON "gestion_ik_vehicules" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);