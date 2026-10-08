import { sql } from 'drizzle-orm';
import { pgPolicy, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { instances } from '../instances/schema.js';

// Columns shared by every business table (docs/plan.md, S3).
export const metierColumns = () => ({
  instanceId: uuid('instance_id')
    .notNull()
    .references(() => instances.id),
  source: text('source').notNull().default('natif'),
  sourceId: text('source_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// nullif: once set locally on a pooled connection, the setting reads '' afterwards, and ''::uuid
// would make every query fail. Without a context, no row is visible.
const currentInstance = sql`nullif(current_setting('app.instance_id', true), '')::uuid`;

// Row-Level Security policy every business table declares (also enables RLS on the table).
export const instanceIsolation = (table: string) =>
  pgPolicy(`${table}_instance_isolation`, {
    as: 'permissive',
    for: 'all',
    to: 'public',
    using: sql`instance_id = ${currentInstance}`,
    withCheck: sql`instance_id = ${currentInstance}`,
  });
