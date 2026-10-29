CREATE TABLE "reunions_wispr" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"wispr_id" text NOT NULL,
	"sujet_id" uuid NOT NULL,
	"titre" text NOT NULL,
	"debut_at" timestamp with time zone NOT NULL,
	"participants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resume" text,
	"critique" boolean DEFAULT false NOT NULL,
	"transcript" text,
	"transcript_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "reunions_wispr" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reunions_wispr" ADD CONSTRAINT "reunions_wispr_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reunions_wispr" ADD CONSTRAINT "reunions_wispr_sujet_id_sujets_id_fk" FOREIGN KEY ("sujet_id") REFERENCES "public"."sujets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reunions_wispr_wispr_idx" ON "reunions_wispr" USING btree ("instance_id","wispr_id");--> statement-breakpoint
CREATE INDEX "reunions_wispr_sujet_idx" ON "reunions_wispr" USING btree ("sujet_id");--> statement-breakpoint
CREATE POLICY "reunions_wispr_instance_isolation" ON "reunions_wispr" AS PERMISSIVE FOR ALL TO public USING (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid) WITH CHECK (instance_id = nullif(current_setting('app.instance_id', true), '')::uuid);