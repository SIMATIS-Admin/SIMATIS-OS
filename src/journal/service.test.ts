import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { withInstance } from '../db/context.js';
import { instances } from '../instances/schema.js';
import { logEvent, recentEvents } from './service.js';

describe('journal', () => {
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
    await withInstance(t.app.db, a, (tx) =>
      logEvent(tx, { acteur: 'pilote', action: 'Événement A', niveau: 'L2' }),
    );
    await withInstance(t.app.db, b, (tx) => logEvent(tx, { acteur: 'os', action: 'Événement B' }));
  });

  afterAll(async () => {
    await t.drop();
  });

  it('records events for the instance of the context, and only shows those', async () => {
    const events = await withInstance(t.app.db, a, (tx) => recentEvents(tx));
    expect(events).toEqual([
      expect.objectContaining({
        instanceId: a,
        acteur: 'pilote',
        action: 'Événement A',
        niveau: 'L2',
      }),
    ]);
  });

  it('refuses an event without instance context for the app role', async () => {
    await expect(logEvent(t.app.db, { acteur: 'os', action: 'Sans contexte' })).rejects.toThrow();
  });

  it('cannot be updated or deleted by the app role', async () => {
    await expect(t.app.pool.query("update journal set action = 'x'")).rejects.toThrow();
    await expect(t.app.pool.query('delete from journal')).rejects.toThrow();
  });

  it('cannot be updated, deleted or truncated even by the owner', async () => {
    await expect(t.owner.pool.query("update journal set action = 'x'")).rejects.toThrow(
      /ajout seul/,
    );
    await expect(t.owner.pool.query('delete from journal')).rejects.toThrow(/ajout seul/);
    await expect(t.owner.pool.query('truncate journal')).rejects.toThrow(/ajout seul/);
  });
});
