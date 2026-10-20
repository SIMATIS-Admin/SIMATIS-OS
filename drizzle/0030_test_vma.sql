CREATE TABLE "vma_tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"entreprise_id" uuid,
	"entreprise_nom" text NOT NULL,
	"type" text NOT NULL,
	"statut" text DEFAULT 'envoyee' NOT NULL,
	"invitation_id" text NOT NULL,
	"lien" text NOT NULL,
	"expire_le" timestamp with time zone NOT NULL,
	"resultat_id" text,
	"recue_le" timestamp with time zone,
	"version" text,
	"parametres" jsonb,
	"reponses" jsonb,
	"calcul" jsonb,
	"ecran" jsonb,
	CONSTRAINT "vma_tests_invitation_id_unique" UNIQUE("invitation_id"),
	CONSTRAINT "vma_tests_resultat_id_unique" UNIQUE("resultat_id")
);
--> statement-breakpoint
ALTER TABLE "vma_tests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "vma_tests" ADD CONSTRAINT "vma_tests_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vma_tests" ADD CONSTRAINT "vma_tests_entreprise_id_entreprises_id_fk" FOREIGN KEY ("entreprise_id") REFERENCES "public"."entreprises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vma_tests_instance_idx" ON "vma_tests" USING btree ("instance_id");--> statement-breakpoint
CREATE POLICY "vma_tests_instance_isolation" ON "vma_tests" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);