import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { instanceIsolation, metierColumns } from '../db/columns.js';

export const propositions = pgTable(
  'propositions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    type: text('type').notNull(),
    contenu: jsonb('contenu').$type<unknown>().notNull(),
    auteur: text('auteur').notNull(),
    statut: text('statut', {
      enum: ['proposee', 'validee', 'modifiee', 'ecartee', 'appliquee', 'echec'],
    })
      .notNull()
      .default('proposee'),
    niveau: text('niveau', { enum: ['L0', 'L1', 'L2', 'L3'] }).notNull(),
    decidePar: text('decide_par'),
    decideAt: timestamp('decide_at', { withTimezone: true }),
    resultat: jsonb('resultat').$type<unknown>(),
  },
  (t) => [
    index('propositions_instance_statut_idx').on(t.instanceId, t.statut),
    instanceIsolation('propositions'),
  ],
);

// Per-instance overrides of the default autonomy levels (src/propositions/autonomie.ts).
export const autonomie = pgTable(
  'autonomie',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    action: text('action').notNull(),
    niveau: text('niveau', { enum: ['L0', 'L1', 'L2', 'L3'] }).notNull(),
  },
  (t) => [
    uniqueIndex('autonomie_instance_action_idx').on(t.instanceId, t.action),
    instanceIsolation('autonomie'),
  ],
);

export type Proposition = typeof propositions.$inferSelect;
