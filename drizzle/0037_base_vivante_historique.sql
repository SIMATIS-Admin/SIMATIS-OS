CREATE TABLE "base_reponses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fiche_id" uuid NOT NULL,
	"mandat" text NOT NULL,
	"message_id" text NOT NULL,
	"recu_le" timestamp with time zone NOT NULL,
	"objet" text,
	"extrait" text DEFAULT '' NOT NULL,
	"auto" boolean DEFAULT false NOT NULL,
	"classe" text,
	"validee" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "base_reponses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "base_vivante" ADD COLUMN "dernier_contact_le" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "base_vivante" ADD COLUMN "dernier_contact_canal" text;--> statement-breakpoint
ALTER TABLE "base_vivante" ADD COLUMN "resultat" text;--> statement-breakpoint
ALTER TABLE "base_vivante" ADD COLUMN "nb_contacts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "base_vivante" ADD COLUMN "mandat_contacteur" text;--> statement-breakpoint
ALTER TABLE "base_vivante" ADD COLUMN "statut_prospection" text DEFAULT 'jamais_contacte' NOT NULL;--> statement-breakpoint
ALTER TABLE "base_vivante" ADD COLUMN "email_invalide" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "base_vivante" ADD COLUMN "opposition" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "base_vivante" ADD COLUMN "exclusion" text;--> statement-breakpoint
ALTER TABLE "base_vivante" ADD COLUMN "crm_mandat" text;--> statement-breakpoint
ALTER TABLE "base_vivante" ADD COLUMN "crm_contact_id" uuid;--> statement-breakpoint
ALTER TABLE "base_reponses" ADD CONSTRAINT "base_reponses_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base_reponses" ADD CONSTRAINT "base_reponses_fiche_id_base_vivante_id_fk" FOREIGN KEY ("fiche_id") REFERENCES "public"."base_vivante"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "base_reponses_message_idx" ON "base_reponses" USING btree ("instance_id","message_id");--> statement-breakpoint
CREATE INDEX "base_reponses_fiche_idx" ON "base_reponses" USING btree ("fiche_id");--> statement-breakpoint
CREATE POLICY "base_reponses_instance_isolation" ON "base_reponses" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);