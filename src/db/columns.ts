import { text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { instances } from '../instances/schema.js';

// Columns shared by every business table (docs/plan.md, S3). Row-Level Security policies come with S3.
export const metierColumns = () => ({
  instanceId: uuid('instance_id')
    .notNull()
    .references(() => instances.id),
  source: text('source').notNull().default('natif'),
  sourceId: text('source_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
