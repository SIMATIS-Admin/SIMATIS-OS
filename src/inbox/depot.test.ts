import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { contacts } from '../crm/schema.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import type { Proposition } from '../propositions/schema.js';
import { propositions } from '../propositions/schema.js';
import { deposerSujet, SujetInvalide, sujetPourProposition, type DepotSujet } from './depot.js';
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

  it('refuses a source link that is not a web address', async () => {
    await expect(
      withInstance(t.app.db, a.id, (tx) =>
        deposerSujet(tx, depot('fil-lien', { lien: 'javascript:alert(1)' })),
      ),
    ).rejects.toBeInstanceOf(SujetInvalide);
    const ok = await withInstance(t.app.db, a.id, (tx) =>
      deposerSujet(tx, depot('fil-lien-ok', { lien: 'https://mail.exemple.fr/fil/1' })),
    );
    expect(ok.statut).toBe('cree');
  });

  it('does not show a subject of another instance', async () => {
    await withInstance(t.app.db, a.id, (tx) => deposerSujet(tx, depot('fil-5')));
    const vus = await withInstance(t.app.db, b.id, (tx) => tx.select().from(sujets));
    expect(vus.some((s) => s.sourceId === 'fil-5')).toBe(false);
  });

  it('keeps a proposal subject when its contact is unknown, dropping only the link', async () => {
    const [p]: Proposition[] = await t.owner.db
      .insert(propositions)
      .values({
        instanceId: a.id,
        type: 'crm.tache',
        contenu: { titre: 'Rappeler', contactId: '00000000-0000-4000-8000-000000000000' },
        auteur: 'os',
        niveau: 'L1',
      })
      .returning();
    if (!p) throw new Error('proposition');
    await withInstance(t.app.db, a.id, (tx) => sujetPourProposition(tx, p));
    const [sujet] = await withInstance(t.app.db, a.id, (tx) =>
      tx.select().from(sujets).where(eq(sujets.propositionId, p.id)),
    );
    expect(sujet).toMatchObject({ titre: 'Rappeler', contactId: null, type: 'a_valider' });
  });
});
