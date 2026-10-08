import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { instances } from '../instances/schema.js';

// MCP tokens: only the SHA-256 hash is stored, the token itself is shown once at creation.
export const jetons = pgTable('jetons', {
  id: uuid('id').primaryKey().defaultRandom(),
  instanceId: uuid('instance_id').references(() => instances.id),
  nom: text('nom').notNull(),
  hash: text('hash').notNull().unique(),
  portee: text('portee', { enum: ['instance', 'portefeuille', 'runner'] }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

export type Jeton = typeof jetons.$inferSelect;
