-- Le diagnostic passe de 3 à 5 étapes. L'ancienne étape 3 (analyse et rapport) devient la revue
-- (3), ou le rapport (4) quand un rapport est déjà déposé.
UPDATE "diagnostic_projets" SET "etape" = 4 WHERE "etape" = 3 AND "rapport" IS NOT NULL;--> statement-breakpoint
UPDATE "diagnostic_projets" SET "etape_max" = 4 WHERE "etape_max" = 3 AND "rapport" IS NOT NULL;
