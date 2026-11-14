CREATE TABLE "contact_echanges_mail" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"contact_id" uuid NOT NULL,
	"envoyes" integer DEFAULT 0 NOT NULL,
	"recus" integer DEFAULT 0 NOT NULL,
	"dernier_envoi" timestamp with time zone,
	"dernier_recu" timestamp with time zone,
	"lu_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact_echanges_mail" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contact_echanges_mail" ADD CONSTRAINT "contact_echanges_mail_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_echanges_mail" ADD CONSTRAINT "contact_echanges_mail_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_echanges_mail_contact_idx" ON "contact_echanges_mail" USING btree ("instance_id","contact_id");--> statement-breakpoint
CREATE POLICY "contact_echanges_mail_instance_isolation" ON "contact_echanges_mail" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);