import {
  date,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { opportunites } from '../crm/schema.js';
import { instanceIsolation, metierColumns } from '../db/columns.js';

// Unit price stays null until the pilot sets it: the OS never proposes a price or a discount.
export type LigneDevis = { libelle: string; quantite: number; prixUnitaire: number | null };

export const devis = pgTable(
  'devis',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    opportuniteId: uuid('opportunite_id')
      .notNull()
      .references(() => opportunites.id),
    numero: text('numero').notNull(),
    statut: text('statut', { enum: ['brouillon', 'valide', 'transmis'] })
      .notNull()
      .default('brouillon'),
    lignes: jsonb('lignes').$type<LigneDevis[]>().notNull().default([]),
    envoyeLe: timestamp('envoye_le', { withTimezone: true }),
    validite: date('validite'),
  },
  (t) => [
    index('devis_instance_idx').on(t.instanceId),
    uniqueIndex('devis_numero_idx').on(t.instanceId, t.numero),
    instanceIsolation('devis'),
  ],
);

export type Devis = typeof devis.$inferSelect;
