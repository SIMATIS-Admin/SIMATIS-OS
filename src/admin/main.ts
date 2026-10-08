import { createDb } from '../db.js';
import { runCommand } from './cli.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL manquante (connexion propriétaire).');
  process.exit(1);
}

const { db, pool } = createDb(url);
const code = await runCommand(process.argv.slice(2), { db, out: (line) => console.log(line) });
await pool.end();
process.exit(code);
