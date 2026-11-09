CREATE TABLE "base_signaux" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"entreprise_id" uuid NOT NULL,
	"date" date NOT NULL,
	"famille" text NOT NULL,
	"nature" text NOT NULL,
	"gravite" text NOT NULL,
	"detail" text,
	"url" text
);
--> statement-breakpoint
ALTER TABLE "base_signaux" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "base_entreprises" ADD COLUMN "signaux_le" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "base_signaux" ADD CONSTRAINT "base_signaux_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base_signaux" ADD CONSTRAINT "base_signaux_entreprise_id_base_entreprises_id_fk" FOREIGN KEY ("entreprise_id") REFERENCES "public"."base_entreprises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "base_signaux_annonce_idx" ON "base_signaux" USING btree ("instance_id","entreprise_id","source_id");--> statement-breakpoint
CREATE INDEX "base_signaux_entreprise_idx" ON "base_signaux" USING btree ("entreprise_id","date");--> statement-breakpoint
CREATE POLICY "base_signaux_instance_isolation" ON "base_signaux" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);