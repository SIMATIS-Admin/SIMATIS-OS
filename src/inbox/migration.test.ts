import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/database.js';
import { createDb, type Database } from '../db.js';
import { runMigrations } from '../migrate.js';

const DRIZZLE = fileURLToPath(new URL('../../drizzle', import.meta.url));

describe('Migration 0017 : sujets', () => {
  let testDb: TestDatabase;
  let db: Database;
  let pool: pg.Pool;
  let avant: string;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    ({ db, pool } = createDb(testDb.url));
    // The migrations as they were before this one.
    avant = await mkdtemp(path.join(tmpdir(), 'simatis-migrations-'));
    await cp(DRIZZLE, avant, { recursive: true });
    const journalPath = path.join(avant, 'meta', '_journal.json');
    const journal = JSON.parse(await readFile(journalPath, 'utf8')) as {
      entries: { idx: number }[];
    };
    journal.entries = journal.entries.filter((e) => e.idx <= 16);
    await writeFile(journalPath, JSON.stringify(journal));
  });

  afterAll(async () => {
    await pool.end();
    await testDb.drop();
    await rm(avant, { recursive: true, force: true });
  });

  it('migrates pending proposals into a_valider subjects', async () => {
    await migrate(db, { migrationsFolder: avant });
    const {
      rows: [instance],
    } = await pool.query<{ id: string }>(
      "insert into instances (slug, nom, type) values ('m', 'M', 'mandat') returning id",
    );
    const {
      rows: [enAttente],
    } = await pool.query<{ id: string }>(
      `insert into propositions (instance_id, type, contenu, auteur, niveau)
       values ($1, 'email.brouillon', '{"objet":"Relance fictive","to":"a@exemple.fr","corps":"x"}', 'os', 'L1')
       returning id`,
      [instance?.id],
    );
    await pool.query(
      `insert into propositions (instance_id, type, contenu, auteur, niveau, statut)
       values ($1, 'crm.tache', '{"titre":"Déjà écartée"}', 'os', 'L1', 'ecartee')`,
      [instance?.id],
    );

    await runMigrations(db);

    const { rows } = await pool.query(
      'select type, titre, origine, statut, source, source_id, proposition_id from sujets',
    );
    expect(rows).toEqual([
      {
        type: 'a_valider',
        titre: 'Relance fictive',
        origine: 'os',
        statut: 'a_traiter',
        source: 'os',
        source_id: enAttente?.id,
        proposition_id: enAttente?.id,
      },
    ]);
  });
});
