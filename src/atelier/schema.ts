import { index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { entreprises } from '../crm/schema.js';
import { instanceIsolation, metierColumns } from '../db/columns.js';

// Contenu d'un atelier : la forme est celle de la sauvegarde de l'outil d'origine. Le serveur ne
// connaît que la version et l'étape ; le reste appartient à l'écran.
export type EtatBrut = { v: 1; step: number } & Record<string, unknown>;

// Atelier stratégique d'une entreprise : six étapes, l'état complet dans une seule colonne.
export const ateliersStrategie = pgTable(
  'ateliers_strategie',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    entrepriseId: uuid('entreprise_id')
      .notNull()
      .references(() => entreprises.id),
    titre: text('titre').notNull(),
    etape: integer('etape').notNull().default(1),
    // Étape la plus haute atteinte : revenir en arrière pour relire ne fait pas reculer l'atelier.
    etapeMax: integer('etape_max').notNull().default(1),
    etat: jsonb('etat').$type<EtatBrut>().notNull(),
  },
  (t) => [
    index('ateliers_strategie_instance_idx').on(t.instanceId),
    instanceIsolation('ateliers_strategie'),
  ],
);

export type Atelier = typeof ateliersStrategie.$inferSelect;
