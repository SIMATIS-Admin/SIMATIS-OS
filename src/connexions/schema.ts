import { jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { instanceIsolation, metierColumns } from '../db/columns.js';

export type Kind = 'crm' | 'messagerie' | 'agenda';
export type Frequence = '5min' | '15min' | '1h' | '1j' | 'manuel';
export type Reglages = { frequence?: Frequence } & Record<string, unknown>;

export const connexions = pgTable(
  'connexions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    kind: text('kind', { enum: ['crm', 'messagerie', 'agenda'] }).notNull(),
    fournisseur: text('fournisseur').notNull(),
    reglages: jsonb('reglages').$type<Reglages>().notNull().default({}),
    etat: text('etat', { enum: ['ok', 'non_configuree', 'erreur'] })
      .notNull()
      .default('non_configuree'),
    derniereSynchro: timestamp('derniere_synchro', { withTimezone: true }),
    // Last attempt, successful or not: schedules the next one, so a failing tool is not hammered.
    derniereTentative: timestamp('derniere_tentative', { withTimezone: true }),
    derniereErreur: text('derniere_erreur'),
  },
  (t) => [
    uniqueIndex('connexions_instance_kind_idx').on(t.instanceId, t.kind),
    instanceIsolation('connexions'),
  ],
);

export type Connexion = typeof connexions.$inferSelect;
