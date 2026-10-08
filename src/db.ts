import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

export type Database = NodePgDatabase;

export function createDb(url: string): { db: Database; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 2000 });
  return { db: drizzle(pool), pool };
}
