import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { contacts, entreprises } from '../crm/schema.js';
import { runCommand } from './cli.js';

describe('admin CLI and instance lifecycle', () => {
  let t: TestApp;
  let lines: string[];

  const run = async (...argv: string[]) => {
    lines = [];
    return runCommand(argv, { db: t.owner.db, out: (line) => lines.push(line) });
  };
  const count = async (sql: string, ...params: unknown[]) =>
    (await t.owner.pool.query<{ n: number }>(sql, params)).rows[0]?.n;

  beforeAll(async () => {
    t = await setupTestApp();
  });

  afterAll(async () => {
    await t.drop();
  });

  it('creates an instance, logs it, and lists it', async () => {
    expect(
      await run('instance:create', '--slug', 'alpha', '--nom', 'Alpha', '--type', 'mandat'),
    ).toBe(0);
    expect(
      await run('instance:create', '--slug', 'beta', '--nom', 'Beta', '--type', 'mandat'),
    ).toBe(0);
    expect(await run('instance:list')).toBe(0);
    expect(lines.join('\n')).toMatch(/alpha\s+mandat\s+actif\s+Alpha/);
    expect(
      await count(
        "select count(*)::int as n from journal j join instances i on i.id = j.instance_id where i.slug = 'alpha'",
      ),
    ).toBe(1);
  });

  it('rejects an invalid slug or type', async () => {
    expect(
      await run('instance:create', '--slug', 'Pas Bon', '--nom', 'X', '--type', 'mandat'),
    ).toBe(1);
    expect(await run('instance:create', '--slug', 'ok', '--nom', 'X', '--type', 'client')).toBe(1);
    expect(lines.join('\n')).toMatch(/Type invalide/);
  });

  it('purges only the business data of one instance, keeps its journal, and archives it', async () => {
    const ids = await t.owner.pool.query<{ id: string; slug: string }>(
      "select id, slug from instances where slug in ('alpha', 'beta')",
    );
    for (const { id } of ids.rows) {
      const [e] = await t.owner.db
        .insert(entreprises)
        .values({ instanceId: id, nom: 'Entreprise' })
        .returning({ id: entreprises.id });
      await t.owner.db
        .insert(contacts)
        .values({ instanceId: id, entrepriseId: e?.id, nom: 'Contact' });
    }

    expect(await run('instance:purge', '--slug', 'alpha')).toBe(1);
    expect(lines.join('\n')).toMatch(/--confirmer/);
    expect(await run('instance:purge', '--slug', 'alpha', '--confirmer')).toBe(0);

    const bySlug = (table: string, slug: string) =>
      count(
        `select count(*)::int as n from ${table} x join instances i on i.id = x.instance_id where i.slug = $1`,
        slug,
      );
    expect(await bySlug('entreprises', 'alpha')).toBe(0);
    expect(await bySlug('contacts', 'alpha')).toBe(0);
    expect(await bySlug('entreprises', 'beta')).toBe(1);
    expect(await bySlug('contacts', 'beta')).toBe(1);
    expect(await bySlug('journal', 'alpha')).toBe(2);
    expect(
      await count(
        "select count(*)::int as n from instances where slug = 'alpha' and statut = 'archive'",
      ),
    ).toBe(1);
  });

  it('prints usage and fails on an unknown command', async () => {
    expect(await run('instance:explode')).toBe(1);
    expect(lines.join('\n')).toMatch(/instance:create/);
  });

  it('opens and closes the per-instance real-write lock, never for a prospect', async () => {
    expect(await run('instance:ecritures', '--slug', 'beta', '--on')).toBe(0);
    expect(lines.join('\n')).toMatch(
      /autorisées pour beta \(effectives seulement avec REAL_WRITES=on\)/,
    );
    const { rows } = await t.owner.pool.query<{ on: boolean }>(
      "select (config->>'ecrituresReelles')::boolean as on from instances where slug = 'beta'",
    );
    expect(rows[0]?.on).toBe(true);
    expect(await run('instance:ecritures', '--slug', 'beta', '--off')).toBe(0);
    expect(await run('instance:ecritures', '--slug', 'beta')).toBe(1);

    expect(
      await run('instance:create', '--slug', 'demo-x', '--nom', 'Démo', '--type', 'prospect'),
    ).toBe(0);
    expect(await run('instance:ecritures', '--slug', 'demo-x', '--on')).toBe(1);
    expect(lines.join('\n')).toMatch(/prospect/);
  });
});
