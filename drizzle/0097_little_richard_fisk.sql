CREATE TABLE "enregistrements_visio" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rendez_vous_id" uuid NOT NULL,
	"statut" text DEFAULT 'en_cours' NOT NULL,
	"debut_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fin_at" timestamp with time zone,
	"dernier_morceau_at" timestamp with time zone DEFAULT now() NOT NULL,
	"transcript" text
);
--> statement-breakpoint
ALTER TABLE "enregistrements_visio" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "morceaux_visio" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"enregistrement_id" uuid NOT NULL,
	"piste" text NOT NULL,
	"rang" integer NOT NULL,
	"debut_ms" integer DEFAULT 0 NOT NULL,
	"mime" text DEFAULT 'audio/webm' NOT NULL,
	"audio" "bytea",
	"texte" text
);
--> statement-breakpoint
ALTER TABLE "morceaux_visio" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "enregistrements_visio" ADD CONSTRAINT "enregistrements_visio_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enregistrements_visio" ADD CONSTRAINT "enregistrements_visio_rendez_vous_id_rendez_vous_id_fk" FOREIGN KEY ("rendez_vous_id") REFERENCES "public"."rendez_vous"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "morceaux_visio" ADD CONSTRAINT "morceaux_visio_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "morceaux_visio" ADD CONSTRAINT "morceaux_visio_enregistrement_id_enregistrements_visio_id_fk" FOREIGN KEY ("enregistrement_id") REFERENCES "public"."enregistrements_visio"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "enregistrements_visio_rdv_idx" ON "enregistrements_visio" USING btree ("rendez_vous_id");--> statement-breakpoint
CREATE UNIQUE INDEX "morceaux_visio_piste_rang_idx" ON "morceaux_visio" USING btree ("enregistrement_id","piste","rang");--> statement-breakpoint
CREATE POLICY "enregistrements_visio_instance_isolation" ON "enregistrements_visio" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "morceaux_visio_instance_isolation" ON "morceaux_visio" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);