import { readdirSync, readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import { seedDemoIfEmpty } from '../demo/seed.js';
import type { Instance } from '../instances/schema.js';
import { listInstances } from '../instances/service.js';
import { eq, sql } from 'drizzle-orm';
import { affaireContacts, contactEntreprises, opportunites } from './schema.js';

// The backfill of existing single links lives in the migration itself: run its INSERT statements
// against the seeded data (the migration ran earlier, on an empty database).
function backfillStatements(): string[] {
  const file = readdirSync('drizzle')
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .find((f) => readFileSync(`drizzle/${f}`, 'utf8').includes('INSERT INTO "affaire_contacts"'));
  if (!file) throw new Error('Migration des liens multiples introuvable');
  return readFileSync(`drizzle/${file}`, 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('INSERT'));
}

describe('tables de liaison', () => {
  let t: TestApp;
  let simatis: Instance;
  let helioval: Instance;

  beforeAll(async () => {
    t = await setupTestApp();
    await seedDemoIfEmpty(t.owner.db);
    const all = await listInstances(t.owner.db);
    simatis = all.find((i) => i.slug === 'simatis') as Instance;
    helioval = all.find((i) => i.slug === 'helioval') as Instance;
    for (const statement of backfillStatements()) await t.owner.pool.query(statement);
  });

  afterAll(async () => {
    await t.drop();
  });

  it('reprend les liens uniques existants comme liens principaux', async () => {
    const { rows } = await t.owner.pool.query<{ manquants: number }>(
      `select count(*)::int as manquants from opportunites o
       where o.contact_id is not null and not exists (
         select 1 from affaire_contacts l
         where l.opportunite_id = o.id and l.contact_id = o.contact_id and l.principal)`,
    );
    expect(rows[0]?.manquants).toBe(0);
    for (const [table, col] of [
      ['affaire_contacts', 'contact_id'],
      ['affaire_entreprises', 'entreprise_id'],
      ['contact_entreprises', 'entreprise_id'],
    ] as const) {
      const { rows: n } = await t.owner.pool.query<{ n: number }>(
        `select count(*)::int as n from ${table} where principal`,
      );
      expect(n[0]?.n).toBeGreaterThan(0);
      expect(col).toBeTruthy();
    }
  });

  it('refuse deux fois la même paire dans une instance', async () => {
    const [lien] = (
      await t.owner.pool.query<{ opportunite_id: string; contact_id: string }>(
        'select opportunite_id, contact_id from affaire_contacts limit 1',
      )
    ).rows;
    await expect(
      t.owner.pool.query(
        `insert into affaire_contacts (instance_id, opportunite_id, contact_id)
         select instance_id, opportunite_id, contact_id from affaire_contacts
         where opportunite_id = $1 and contact_id = $2`,
        [lien?.opportunite_id, lien?.contact_id],
      ),
    ).rejects.toThrow(/unique/i);
  });

  it('supprime les liens avec la fiche', async () => {
    const [lien] = (
      await t.owner.pool.query<{ opportunite_id: string }>(
        'select opportunite_id from affaire_contacts limit 1',
      )
    ).rows;
    const id = lien?.opportunite_id as string;
    await t.owner.pool.query('delete from taches where opportunite_id = $1', [id]);
    await t.owner.pool.query('delete from activites where opportunite_id = $1', [id]);
    await t.owner.pool.query('delete from opportunites where id = $1', [id]);
    const { rows } = await t.owner.pool.query(
      'select 1 from affaire_contacts where opportunite_id = $1',
      [id],
    );
    expect(rows).toHaveLength(0);
  });

  it('isole les liens par instance', async () => {
    const visibles = async (i: Instance) =>
      withInstance(
        t.app.db,
        i.id,
        async (tx) =>
          (
            await tx
              .select()
              .from(affaireContacts)
              .where(eq(affaireContacts.instanceId, currentInstance))
          ).length,
      );
    const [a, b] = [await visibles(simatis), await visibles(helioval)];
    const { rows } = await t.owner.pool.query<{ n: number }>(
      'select count(*)::int as n from affaire_contacts',
    );
    expect(a + b).toBeLessThanOrEqual(rows[0]?.n ?? 0);
    const croise = await withInstance(t.app.db, simatis.id, (tx) =>
      tx
        .select()
        .from(contactEntreprises)
        .where(sql`instance_id <> ${currentInstance}`),
    );
    expect(croise).toHaveLength(0);
    expect(opportunites).toBeDefined();
  });
});
