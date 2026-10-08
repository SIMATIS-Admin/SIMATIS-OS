import { buildApp } from './app.js';
import { loadConfig, type Config } from './config.js';
import { createDb } from './db.js';
import { runMigrations } from './migrate.js';
import { readVersion } from './version.js';

let config: Config;
try {
  config = loadConfig(process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const { db, pool } = createDb(config.databaseUrl);
const app = buildApp({ pool, version: readVersion(), logger: { level: config.logLevel } });

// An idle client losing its connection (database restart) must not crash the process.
pool.on('error', (err) => app.log.warn({ err }, 'idle database client error'));

try {
  await runMigrations(db);
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
