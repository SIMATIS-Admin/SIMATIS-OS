ALTER TABLE "vma_tests" ADD COLUMN "contact_id" uuid;--> statement-breakpoint
ALTER TABLE "vma_tests" ADD COLUMN "contact_prenom" text;--> statement-breakpoint
ALTER TABLE "vma_tests" ADD COLUMN "contact_nom_famille" text;--> statement-breakpoint
ALTER TABLE "vma_tests" ADD COLUMN "contact_poste" text;--> statement-breakpoint
ALTER TABLE "vma_tests" ADD COLUMN "contact_telephone" text;--> statement-breakpoint
ALTER TABLE "vma_tests" ADD COLUMN "origine" text DEFAULT 'invitation' NOT NULL;--> statement-breakpoint
ALTER TABLE "vma_tests" ADD COLUMN "consentement" jsonb;--> statement-breakpoint
ALTER TABLE "vma_tests" ADD CONSTRAINT "vma_tests_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;