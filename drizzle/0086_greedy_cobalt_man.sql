CREATE TABLE "base_liste_entreprises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"liste_id" uuid NOT NULL,
	"entreprise_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "base_liste_entreprises" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "base_listes" ADD COLUMN "type" text DEFAULT 'contacts' NOT NULL;--> statement-breakpoint
ALTER TABLE "base_liste_entreprises" ADD CONSTRAINT "base_liste_entreprises_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base_liste_entreprises" ADD CONSTRAINT "base_liste_entreprises_liste_id_base_listes_id_fk" FOREIGN KEY ("liste_id") REFERENCES "public"."base_listes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base_liste_entreprises" ADD CONSTRAINT "base_liste_entreprises_entreprise_id_base_entreprises_id_fk" FOREIGN KEY ("entreprise_id") REFERENCES "public"."base_entreprises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "base_liste_entreprises_paire_idx" ON "base_liste_entreprises" USING btree ("liste_id","entreprise_id");--> statement-breakpoint
CREATE INDEX "base_liste_entreprises_entreprise_idx" ON "base_liste_entreprises" USING btree ("entreprise_id");--> statement-breakpoint
CREATE POLICY "base_liste_entreprises_instance_isolation" ON "base_liste_entreprises" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);