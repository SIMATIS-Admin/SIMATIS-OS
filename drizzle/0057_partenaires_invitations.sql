CREATE TABLE "invitations_partenaires" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"code" text NOT NULL,
	"lien" text NOT NULL,
	"email" text,
	"expire_at" timestamp with time zone NOT NULL,
	"acceptee_at" timestamp with time zone,
	"connexion_id" text,
	"cree_par" text
);
--> statement-breakpoint
ALTER TABLE "invitations_partenaires" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invitations_partenaires" ADD CONSTRAINT "invitations_partenaires_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_partenaires_code_idx" ON "invitations_partenaires" USING btree ("instance_id","code");--> statement-breakpoint
CREATE POLICY "invitations_partenaires_instance_isolation" ON "invitations_partenaires" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);