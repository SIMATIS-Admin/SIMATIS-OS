CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"entreprise_id" uuid,
	"nom" text NOT NULL,
	"fonction" text,
	"email" text,
	"telephone" text,
	"role" text
);
--> statement-breakpoint
CREATE TABLE "entreprises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"source" text DEFAULT 'natif' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"nom" text NOT NULL,
	"secteur" text,
	"ville" text,
	"taille" integer,
	"domaine" text
);
--> statement-breakpoint
CREATE TABLE "instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"nom" text NOT NULL,
	"type" text NOT NULL,
	"statut" text DEFAULT 'actif' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instances_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_entreprise_id_entreprises_id_fk" FOREIGN KEY ("entreprise_id") REFERENCES "public"."entreprises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entreprises" ADD CONSTRAINT "entreprises_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contacts_instance_idx" ON "contacts" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "entreprises_instance_idx" ON "entreprises" USING btree ("instance_id");