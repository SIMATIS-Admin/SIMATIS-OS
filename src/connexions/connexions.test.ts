import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { runCommand } from '../admin/cli.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import './fake.js';
import type { Reglages } from './schema.js';
import { configureConnexion, getConnector, runSchedulerTick, syncConnexion } from './service.js';

const deps = { secretsDir: '/nonexistent', realWrites: false };
const HOUR = 60 * 60_000;

describe('connections framework', () => {
  let t: TestApp;
  let a: Instance;
  let b: Instance;

  const configure = (instance: Instance, kind: 'crm' | 'messagerie', reglages: Reglages) =>
    withInstance(t.app.db, instance.id, (tx) =>
      configureConnexion(tx, { kind, fournisseur: 'fake', reglages }),
    );
  const countEntreprises = async (instance: Instance) =>
    (
      await t.owner.pool.query<{ n: number }>(
        'select count(*)::int as n from entreprises where instance_id = $1',
        [instance.id],
      )
    ).rows[0]?.n;
  const connexion = async (instance: Instance, kind: string) =>
    (
      await t.owner.pool.query<{ etat: string; derniere_erreur: string | null }>(
        'select etat, derniere_erreur from connexions where instance_id = $1 and kind = $2',
        [instance.id, kind],
      )
    ).rows[0];

  beforeAll(async () => {
    t = await setupTestApp();
    a = await createInstance(t.owner.db, { slug: 'a', nom: 'A', type: 'mandat' });
    b = await createInstance(t.owner.db, { slug: 'b', nom: 'B', type: 'mandat' });
  });

  afterAll(async () => {
    await t.drop();
  });

  it('writes the synchronized copy into its own instance only', async () => {
    await configure(a, 'crm', { frequence: '15min', entreprises: ['Alpha SA', 'Beta SARL'] });
    const report = await syncConnexion(t.app.db, a, 'crm', deps);
    expect(report).toMatchObject({ lus: 2, crees: 2, maj: 0 });
    expect(await countEntreprises(a)).toBe(2);
    expect(await countEntreprises(b)).toBe(0);

    const again = await syncConnexion(t.app.db, a, 'crm', deps);
    expect(again).toMatchObject({ crees: 0, maj: 2 });
    expect(await countEntreprises(a)).toBe(2);
  });

  it('never borrows another instance’s connection', async () => {
    await configure(a, 'messagerie', { frequence: 'manuel' });
    const forB = await withInstance(t.app.db, b.id, (tx) => getConnector(tx, 'messagerie'));
    expect(forB).toBeNull();
    const forA = await withInstance(t.app.db, a.id, (tx) => getConnector(tx, 'messagerie'));
    expect(forA?.connexion.instanceId).toBe(a.id);
  });

  it('also picks the right instance on the owner connection, which bypasses RLS', async () => {
    const forB = await withInstance(t.owner.db, b.id, (tx) => getConnector(tx, 'messagerie'));
    expect(forB).toBeNull();
  });

  it('catches up once after a long pause, not once per missed period', async () => {
    // After every real-time sync made by the previous tests.
    const start = new Date(Date.now() + 24 * HOUR);
    await configure(b, 'crm', { frequence: '15min', entreprises: ['Gamma'] });
    expect(await runSchedulerTick(t.app.db, deps, start)).toBeGreaterThanOrEqual(1);

    const afterPause = new Date(start.getTime() + 3 * HOUR);
    const first = await runSchedulerTick(t.app.db, deps, afterPause);
    const second = await runSchedulerTick(t.app.db, deps, new Date(afterPause.getTime() + 60_000));
    // a crm (15 min) and b crm (15 min) are both due once; a messagerie is manual.
    expect(first).toBe(2);
    expect(second).toBe(0);
  });

  it('keeps the local copy and records the error when a sync fails, then recovers', async () => {
    const before = await countEntreprises(a);
    await configure(a, 'crm', { frequence: '15min', entreprises: ['Nouvelle'], echouer: true });
    await expect(syncConnexion(t.app.db, a, 'crm', deps)).rejects.toThrow(/429/);
    expect(await countEntreprises(a)).toBe(before);
    expect(await connexion(a, 'crm')).toMatchObject({
      etat: 'erreur',
      derniere_erreur: 'Outil factice indisponible (429)',
    });

    await configure(a, 'crm', { frequence: '15min', entreprises: ['Nouvelle'] });
    await syncConnexion(t.app.db, a, 'crm', deps);
    expect(await connexion(a, 'crm')).toMatchObject({ etat: 'ok', derniere_erreur: null });
  });

  it('sets up and synchronizes a connection from the CLI', async () => {
    const lines: string[] = [];
    const run = (...argv: string[]) =>
      runCommand(argv, { db: t.owner.db, out: (l) => lines.push(l), ...deps });
    expect(
      await run('connexion:set', '--slug', 'b', '--kind', 'agenda', '--fournisseur', 'fake'),
    ).toBe(0);
    expect(await run('connexion:sync', '--slug', 'b', '--kind', 'agenda')).toBe(0);
    expect(await run('connexion:list', '--slug', 'b')).toBe(0);
    expect(lines.join('\n')).toMatch(/agenda\s+fake\s+ok/);
    expect(
      await run(
        'connexion:set',
        '--slug',
        'b',
        '--kind',
        'crm',
        '--fournisseur',
        'fake',
        '--frequence',
        'parfois',
      ),
    ).toBe(1);
  });
});
