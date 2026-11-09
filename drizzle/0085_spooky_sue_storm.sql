CREATE TABLE "base_liste_fiches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"liste_id" uuid NOT NULL,
	"fiche_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "base_liste_fiches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "base_listes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"nom" text NOT NULL,
	"mandat" text
);
--> statement-breakpoint
ALTER TABLE "base_listes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "base_vivante" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "base_liste_fiches" ADD CONSTRAINT "base_liste_fiches_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base_liste_fiches" ADD CONSTRAINT "base_liste_fiches_liste_id_base_listes_id_fk" FOREIGN KEY ("liste_id") REFERENCES "public"."base_listes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base_liste_fiches" ADD CONSTRAINT "base_liste_fiches_fiche_id_base_vivante_id_fk" FOREIGN KEY ("fiche_id") REFERENCES "public"."base_vivante"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base_listes" ADD CONSTRAINT "base_listes_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "base_liste_fiches_paire_idx" ON "base_liste_fiches" USING btree ("liste_id","fiche_id");--> statement-breakpoint
CREATE INDEX "base_liste_fiches_fiche_idx" ON "base_liste_fiches" USING btree ("fiche_id");--> statement-breakpoint
CREATE UNIQUE INDEX "base_listes_nom_idx" ON "base_listes" USING btree ("instance_id",lower("nom"));--> statement-breakpoint
CREATE POLICY "base_liste_fiches_instance_isolation" ON "base_liste_fiches" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "base_listes_instance_isolation" ON "base_listes" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);