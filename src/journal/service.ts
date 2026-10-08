import { desc, eq } from 'drizzle-orm';
import type { Executor } from '../db.js';
import { currentInstance } from '../db/columns.js';
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
    instanceId: currentInstance,
    acteur: event.acteur,
    action: event.action,
    niveau: event.niveau ?? null,
    details: event.details ?? {},
  });
}

export async function recentEvents(tx: Executor, limit = 50) {
  return tx
    .select()
    .from(journal)
    .where(eq(journal.instanceId, currentInstance))
    .orderBy(desc(journal.at), desc(journal.id))
    .limit(limit);
}
