import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Database } from './db.js';

// Same relative path from src/ (dev, tests) and dist/ (build).
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder });
}
