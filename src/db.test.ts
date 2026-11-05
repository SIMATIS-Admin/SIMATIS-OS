import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '../test/database.js';
import { createDb } from './db.js';

describe('createDb', () => {
  // Postgres coupe une connexion inactive (redémarrage, base supprimée) : le pool l'écarte et en
  // rouvre une au besoin. Sans écouteur d'erreur sur le pool, Node traite l'événement comme fatal.
  it('une connexion inactive coupée par le serveur ne fait pas tomber le processus', async () => {
    const testDb = await createTestDatabase();
    const { pool } = createDb(testDb.url);
    await pool.query('select 1');
    expect(pool.idleCount).toBe(1);
    await testDb.drop();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(pool.idleCount).toBe(0);
    await pool.end();
  });
});
