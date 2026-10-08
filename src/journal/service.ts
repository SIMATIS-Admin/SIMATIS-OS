import { desc, sql } from 'drizzle-orm';
import type { Executor } from '../db.js';
import { journal } from './schema.js';

export type JournalEvent = {
  acteur: string;
  action: string;
  niveau?: string;
  details?: Record<string, unknown>;
};

// The instance comes from the transaction context set by withInstance, never from the caller.
export async function logEvent(tx: Executor, event: JournalEvent): Promise<void> {
  await tx.insert(journal).values({
    instanceId: sql`nullif(current_setting('app.instance_id', true), '')::uuid`,
    acteur: event.acteur,
    action: event.action,
    niveau: event.niveau ?? null,
    details: event.details ?? {},
  });
}

export async function recentEvents(tx: Executor, limit = 50) {
  return tx.select().from(journal).orderBy(desc(journal.at), desc(journal.id)).limit(limit);
}
