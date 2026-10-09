import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { instanceIsolation, metierColumns } from '../db/columns.js';

export type CleRoutine = 'quotidienne' | 'nettoyage' | 'hebdo' | 'evenement';
export type StatutExecution = 'demandee' | 'en_cours' | 'terminee' | 'echouee';
export type EtapeExecution = { etape: string; statut: 'en_cours' | 'fait' | 'echec'; at: string };
export type Rapport = { fait: string[]; attente: string[]; echec: string[] };

// One row per routine and instance: on/off switch, settings, and the Claude skill it runs.
export const routines = pgTable(
  'routines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    cle: text('cle', { enum: ['quotidienne', 'nettoyage', 'hebdo', 'evenement'] }).notNull(),
    actif: boolean('actif').notNull().default(true),
    params: jsonb('params').$type<Record<string, unknown>>().notNull().default({}),
    skill: text('skill').notNull(),
  },
  (t) => [uniqueIndex('routines_cle_idx').on(t.instanceId, t.cle), instanceIsolation('routines')],
);

export const executions = pgTable(
  'executions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...metierColumns(),
    routine: text('routine', {
      enum: ['quotidienne', 'nettoyage', 'hebdo', 'evenement'],
    }).notNull(),
    statut: text('statut', { enum: ['demandee', 'en_cours', 'terminee', 'echouee'] })
      .notNull()
      .default('demandee'),
    demandePar: text('demande_par').notNull(),
    debut: timestamp('debut', { withTimezone: true }),
    fin: timestamp('fin', { withTimezone: true }),
    etapes: jsonb('etapes').$type<EtapeExecution[]>().notNull().default([]),
    rapport: jsonb('rapport').$type<Rapport>(),
  },
  (t) => [
    index('executions_instance_idx').on(t.instanceId, t.createdAt),
    // Vigilance 5: never two open runs of the same routine on one instance.
    uniqueIndex('executions_ouverte_idx')
      .on(t.instanceId, t.routine)
      .where(sql`statut in ('demandee', 'en_cours')`),
    instanceIsolation('executions'),
  ],
);

export type Routine = typeof routines.$inferSelect;
export type Execution = typeof executions.$inferSelect;
