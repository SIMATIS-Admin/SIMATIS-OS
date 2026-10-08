CREATE TABLE "journal" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "journal_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"instance_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"acteur" text NOT NULL,
	"action" text NOT NULL,
	"niveau" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "journal" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "journal" ADD CONSTRAINT "journal_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "journal_instance_at_idx" ON "journal" USING btree ("instance_id","at");--> statement-breakpoint
CREATE POLICY "journal_instance_isolation" ON "journal" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);