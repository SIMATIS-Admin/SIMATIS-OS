CREATE TABLE "jetons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid,
	"nom" text NOT NULL,
	"hash" text NOT NULL,
	"portee" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "jetons_hash_unique" UNIQUE("hash")
);
--> statement-breakpoint
ALTER TABLE "jetons" ADD CONSTRAINT "jetons_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;