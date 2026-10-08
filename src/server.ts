import { buildApp } from './app.js';
import { loadConfig, type Config } from './config.js';
import { createDb } from './db.js';
import { appDatabaseUrl, ensureAppRole } from './db/roles.js';
import { seedDemoIfEmpty } from './demo/seed.js';
import { runMigrations } from './migrate.js';
import { readVersion } from './version.js';

let config: Config;
try {
  config = loadConfig(process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

// The app runs as the restricted role; the owner connection only serves startup work below.
const { db, pool } = createDb(
  appDatabaseUrl(config.databaseUrl, config.appDbRole, config.appDbPassword),
);
const app = buildApp({ pool, db, version: readVersion(), logger: { level: config.logLevel } });

// An idle client losing its connection (database restart) must not crash the process.
pool.on('error', (err) => app.log.warn({ err }, 'idle database client error'));

async function prepareDatabase(): Promise<void> {
  const owner = createDb(config.databaseUrl);
  try {
    await runMigrations(owner.db);
    await ensureAppRole(owner.pool, { role: config.appDbRole, password: config.appDbPassword });
    if (await seedDemoIfEmpty(owner.db)) {
      app.log.info('empty database: fictive demo instances loaded');
    }
  } finally {
    await owner.pool.end();
  }
}

try {
  await prepareDatabase();
  await app.listen({ host: config.host, port: config.port });
} catch (err) {
  app.log.fatal({ err }, 'startup failed');
  await pool.end();
  process.exit(1);
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    void app
      .close()
      .then(() => pool.end())
      .then(() => process.exit(0));
  });
}
