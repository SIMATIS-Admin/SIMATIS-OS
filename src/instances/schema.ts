import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export type InstanceType = 'propre' | 'mandat' | 'prospect';

export type InstanceConfig = {
  sous?: string;
  couleur?: string;
  modules?: string[];
  // Second lock for real writes to third-party tools (the first is REAL_WRITES on the server).
  ecrituresReelles?: boolean;
  // Dashboard funnel settings (pilotage/funnel.ts); defaults apply when missing.
  funnel?: Record<string, number>;
};

export const instances = pgTable('instances', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  nom: text('nom').notNull(),
  type: text('type', { enum: ['propre', 'mandat', 'prospect'] }).notNull(),
  statut: text('statut', { enum: ['actif', 'archive'] })
    .notNull()
    .default('actif'),
  config: jsonb('config').$type<InstanceConfig>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Instance = typeof instances.$inferSelect;
