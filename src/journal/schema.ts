import { bigint, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { instanceIsolation } from '../db/columns.js';
import { instances } from '../instances/schema.js';

// Append-only: a trigger (migration 0003) rejects UPDATE, DELETE and TRUNCATE, even for the owner.
export const journal = pgTable(
  'journal',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    instanceId: uuid('instance_id').references(() => instances.id),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    acteur: text('acteur').notNull(),
    action: text('action').notNull(),
    niveau: text('niveau'),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [index('journal_instance_at_idx').on(t.instanceId, t.at), instanceIsolation('journal')],
);
