CREATE TABLE "enrichissement_lignes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tache_id" uuid NOT NULL,
	"fiche_id" uuid NOT NULL,
	"etat" text NOT NULL,
	"raison" text
);
--> statement-breakpoint
ALTER TABLE "enrichissement_lignes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "enrichissement_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tache_id" uuid NOT NULL,
	"fiche_id" uuid NOT NULL,
	"prenom" text,
	"nom" text,
	"fonction" text,
	"email" text,
	"telephone" text,
	"source_url" text,
	"confiance" text NOT NULL,
	"mode_email" text,
	"etat" text DEFAULT 'a_valider' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "enrichissement_suggestions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "enrichissement_taches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"type" text NOT NULL,
	"profil" jsonb NOT NULL,
	"max_par_entreprise" integer NOT NULL,
	"etat" text NOT NULL,
	"jetons" integer DEFAULT 0 NOT NULL,
	"erreur" text
);
--> statement-breakpoint
ALTER TABLE "enrichissement_taches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "enrichissement_lignes" ADD CONSTRAINT "enrichissement_lignes_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichissement_lignes" ADD CONSTRAINT "enrichissement_lignes_tache_id_enrichissement_taches_id_fk" FOREIGN KEY ("tache_id") REFERENCES "public"."enrichissement_taches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichissement_lignes" ADD CONSTRAINT "enrichissement_lignes_fiche_id_base_vivante_id_fk" FOREIGN KEY ("fiche_id") REFERENCES "public"."base_vivante"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichissement_suggestions" ADD CONSTRAINT "enrichissement_suggestions_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichissement_suggestions" ADD CONSTRAINT "enrichissement_suggestions_tache_id_enrichissement_taches_id_fk" FOREIGN KEY ("tache_id") REFERENCES "public"."enrichissement_taches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichissement_suggestions" ADD CONSTRAINT "enrichissement_suggestions_fiche_id_base_vivante_id_fk" FOREIGN KEY ("fiche_id") REFERENCES "public"."base_vivante"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichissement_taches" ADD CONSTRAINT "enrichissement_taches_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "enrichissement_lignes_tache_idx" ON "enrichissement_lignes" USING btree ("tache_id");--> statement-breakpoint
CREATE INDEX "enrichissement_suggestions_tache_idx" ON "enrichissement_suggestions" USING btree ("tache_id");--> statement-breakpoint
CREATE INDEX "enrichissement_taches_instance_idx" ON "enrichissement_taches" USING btree ("instance_id","created_at");--> statement-breakpoint
CREATE POLICY "enrichissement_lignes_instance_isolation" ON "enrichissement_lignes" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "enrichissement_suggestions_instance_isolation" ON "enrichissement_suggestions" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "enrichissement_taches_instance_isolation" ON "enrichissement_taches" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);