import { sql } from 'drizzle-orm';
import type { Executor, Tx } from '../db.js';

// Every business query runs here: Row-Level Security only lets the current instance's rows through.
export async function withInstance<T>(
  db: Executor,
  instanceId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.instance_id', ${instanceId}, true)`);
    return fn(tx);
  });
}
