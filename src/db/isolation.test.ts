import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { entreprises } from '../crm/schema.js';
import { instances } from '../instances/schema.js';
import { withInstance } from './context.js';

describe('Row-Level Security between instances', () => {
  let t: TestApp;
  let a: string;
  let b: string;

  beforeAll(async () => {
    t = await setupTestApp();
    const rows = await t.owner.db
      .insert(instances)
      .values([
        { slug: 'a', nom: 'A', type: 'mandat' },
        { slug: 'b', nom: 'B', type: 'mandat' },
      ])
      .returning({ id: instances.id });
    a = rows[0]?.id ?? '';
    b = rows[1]?.id ?? '';
    await t.owner.db.insert(entreprises).values([
      { instanceId: a, nom: 'Alpha A' },
      { instanceId: b, nom: 'Beta B' },
    ]);
  });

  afterAll(async () => {
    await t.drop();
  });

  it('only shows the current instance rows, even without a WHERE clause', async () => {
    const rows = await withInstance(t.app.db, a, (tx) => tx.select().from(entreprises));
    expect(rows.map((r) => r.nom)).toEqual(['Alpha A']);
  });

  it('shows no business row at all to a raw query without instance context', async () => {
    const { rows } = await t.app.pool.query<{ n: number }>(
      'select count(*)::int as n from entreprises',
    );
    expect(rows[0]?.n).toBe(0);
  });

  it('refuses to write a row for another instance', async () => {
    await expect(
      withInstance(t.app.db, a, (tx) => tx.insert(entreprises).values({ instanceId: b, nom: 'X' })),
    ).rejects.toThrow();
  });

  it('keeps working on a pooled connection after a context was set (nullif trap)', async () => {
    const single = new pg.Pool({ connectionString: t.appUrl, max: 1 });
    try {
      const db = drizzle(single);
      await withInstance(db, a, (tx) => tx.execute(sql`select 1`));
      const { rows } = await single.query<{ n: number }>(
        'select count(*)::int as n from entreprises',
      );
      expect(rows[0]?.n).toBe(0);
    } finally {
      await single.end();
    }
  });
});
