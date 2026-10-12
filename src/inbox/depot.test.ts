import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { contacts } from '../crm/schema.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { deposerSujet, SujetInvalide, type DepotSujet } from './depot.js';
import { sujets } from './schema.js';

const depot = (cle: string, extra: Partial<DepotSujet> = {}): DepotSujet => ({
  type: 'mail_a_repondre',
  titre: 'Répondre à la demande de rendez-vous',
  origine: 'messagerie',
  source: 'routine',
  sourceId: cle,
  ...extra,
});

describe('Inbox : dépôt de sujets', () => {
  let t: TestApp;
  let a: Instance;
  let b: Instance;

  beforeAll(async () => {
    t = await setupTestApp();
    a = await createInstance(t.owner.db, { slug: 'depot-a', nom: 'A', type: 'mandat' });
    b = await createInstance(t.owner.db, { slug: 'depot-b', nom: 'B', type: 'mandat' });
  });

  afterAll(async () => {
    await t.drop();
  });

  const lignes = async (instanceId: string, cle: string) =>
    (
      await t.owner.pool.query<{ id: string; statut: string }>(
        'select id, statut from sujets where instance_id = $1 and source_id = $2',
        [instanceId, cle],
      )
    ).rows;

  it('deposits a subject and returns cree, then existant for the same key', async () => {
    const premier = await withInstance(t.app.db, a.id, (tx) => deposerSujet(tx, depot('fil-1')));
    const second = await withInstance(t.app.db, a.id, (tx) => deposerSujet(tx, depot('fil-1')));
    expect(premier.statut).toBe('cree');
    expect(second).toEqual({ statut: 'existant', id: premier.id });
    expect(await lignes(a.id, 'fil-1')).toHaveLength(1);
  });

  it('never recreates a subject whose key exists, even once it is traite', async () => {
    const { id } = await withInstance(t.app.db, a.id, (tx) => deposerSujet(tx, depot('fil-2')));
    await t.owner.pool.query("update sujets set statut = 'traite' where id = $1", [id]);
    const again = await withInstance(t.app.db, a.id, (tx) => deposerSujet(tx, depot('fil-2')));
    expect(again).toEqual({ statut: 'existant', id });
    expect(await lignes(a.id, 'fil-2')).toEqual([{ id, statut: 'traite' }]);
  });

  it('accepts the same key in two instances', async () => {
    await withInstance(t.app.db, a.id, (tx) => deposerSujet(tx, depot('fil-3')));
    const autre = await withInstance(t.app.db, b.id, (tx) => deposerSujet(tx, depot('fil-3')));
    expect(autre.statut).toBe('cree');
  });

  it('refuses a contact of another instance', async () => {
    const [contact] = await t.owner.db
      .insert(contacts)
      .values({ instanceId: b.id, nom: 'Contact fictif' })
      .returning({ id: contacts.id });
    await expect(
      withInstance(t.app.db, a.id, (tx) =>
        deposerSujet(tx, depot('fil-4', { contactId: contact?.id ?? null })),
      ),
    ).rejects.toBeInstanceOf(SujetInvalide);
  });

  it('does not show a subject of another instance', async () => {
    await withInstance(t.app.db, a.id, (tx) => deposerSujet(tx, depot('fil-5')));
    const vus = await withInstance(t.app.db, b.id, (tx) => tx.select().from(sujets));
    expect(vus.some((s) => s.sourceId === 'fil-5')).toBe(false);
  });
});
