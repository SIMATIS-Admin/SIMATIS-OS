CREATE TABLE "base_correspondances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provenance" text NOT NULL,
	"memoire" jsonb NOT NULL,
	"mis_a_jour_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "base_correspondances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "base_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"nom_fichier" text NOT NULL,
	"feuille" text NOT NULL,
	"provenance" text NOT NULL,
	"mandat" text,
	"collecte_le" date,
	"statut" text DEFAULT 'apercu' NOT NULL,
	"entetes" jsonb NOT NULL,
	"correspondance" jsonb NOT NULL,
	"rapport" jsonb
);
--> statement-breakpoint
ALTER TABLE "base_imports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "base_lignes_brutes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"import_id" uuid NOT NULL,
	"numero" integer NOT NULL,
	"brut" jsonb NOT NULL,
	"complements" jsonb,
	"fiche" jsonb NOT NULL,
	"statut" text NOT NULL,
	"zone" text,
	"raison" text,
	"avertissements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fiche_id" uuid
);
--> statement-breakpoint
ALTER TABLE "base_lignes_brutes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "base_vivante" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"zone" text NOT NULL,
	"entreprise" text NOT NULL,
	"civilite" text,
	"civilite_deduite" boolean DEFAULT false NOT NULL,
	"prenom" text,
	"nom" text NOT NULL,
	"email" text,
	"telephone" text,
	"fonction" text,
	"linkedin" text,
	"domaine" text,
	"provenance" text NOT NULL,
	"mandat" text,
	"import_id" uuid,
	"collecte_le" date,
	"cles" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "base_vivante" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "base_correspondances" ADD CONSTRAINT "base_correspondances_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base_imports" ADD CONSTRAINT "base_imports_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base_lignes_brutes" ADD CONSTRAINT "base_lignes_brutes_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base_lignes_brutes" ADD CONSTRAINT "base_lignes_brutes_import_id_base_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."base_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base_vivante" ADD CONSTRAINT "base_vivante_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base_vivante" ADD CONSTRAINT "base_vivante_import_id_base_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."base_imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "base_correspondances_provenance_idx" ON "base_correspondances" USING btree ("instance_id","provenance");--> statement-breakpoint
CREATE INDEX "base_imports_instance_idx" ON "base_imports" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "base_lignes_import_idx" ON "base_lignes_brutes" USING btree ("import_id","numero");--> statement-breakpoint
CREATE INDEX "base_lignes_instance_idx" ON "base_lignes_brutes" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "base_vivante_instance_idx" ON "base_vivante" USING btree ("instance_id","zone");--> statement-breakpoint
CREATE INDEX "base_vivante_cles_idx" ON "base_vivante" USING gin ("cles");--> statement-breakpoint
CREATE POLICY "base_correspondances_instance_isolation" ON "base_correspondances" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "base_imports_instance_isolation" ON "base_imports" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "base_lignes_brutes_instance_isolation" ON "base_lignes_brutes" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "base_vivante_instance_isolation" ON "base_vivante" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);