ALTER TABLE "vma_tests" ADD COLUMN "tutoiement" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "vma_tests" ADD COLUMN "envoyee_le" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vma_tests" ADD COLUMN "relances" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "vma_tests" ADD COLUMN "echec_envoi" text;--> statement-breakpoint
ALTER TABLE "vma_tests" ADD COLUMN "relance_auto" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
-- Invitations déjà envoyées : le mail partait à la création, donc date d'envoi = date de création.
UPDATE "vma_tests" SET "envoyee_le" = "created_at" WHERE "contact_email" IS NOT NULL;
--> statement-breakpoint
-- Elles restent à relancer à la main : la routine ne vise que les invitations créées après elle.
UPDATE "vma_tests" SET "relance_auto" = false;
