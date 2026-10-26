import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { creerMonde, fabrique, type Monde } from '../../test/transfert.js';
import { instances } from '../instances/schema.js';
import { eq } from 'drizzle-orm';
import { executerTransfert } from './executer.js';
import { RacineIntrouvable, TransfertRefuse } from './plan.js';
import type { TypeObjet } from './types.js';

describe('executerTransfert : garanties', () => {
  let t: TestApp;
  let m: Monde;
  let f: ReturnType<typeof fabrique>;

  beforeAll(async () => {
    t = await setupTestApp();
    m = await creerMonde(t);
    f = fabrique(t);
  });
  afterAll(() => t.drop());

  const lancer = (type: TypeObjet, id: string, cible = m.a.id) =>
    executerTransfert(t.owner.db, {
      instanceOrigine: m.siege.id,
      cible,
      racine: { type, id },
      exclusions: [],
    });
  const journalDe = async (instance: string, action: string) =>
    (
      await t.owner.pool.query<{ details: Record<string, unknown> }>(
        'select details from journal where instance_id = $1 and action = $2',
        [instance, action],
      )
    ).rows.map((r) => r.details);

  it('écrit le déplacement dans le journal des deux instances, avec les compteurs', async () => {
    const affaire = await f.affaire(m.siege, 'Affaire journalisée');
    await f.tache(m.siege, 'Tâche journalisée', { opportunite: affaire });
    await lancer('affaire', affaire);
    for (const instance of [m.siege.id, m.a.id]) {
      const e = await journalDe(instance, 'transfert.deplace');
      expect(e).toContainEqual({
        racine: { type: 'affaire', id: affaire },
        origine: m.siege.id,
        cible: m.a.id,
        compteurs: { affaire: 1, tache: 1 },
      });
    }
  });

  it('écrit aussi la copie dans le journal des deux instances', async () => {
    const contact = await f.contact(m.siege, 'Copie journalisée', 'hubspot', 'j-1');
    const r = await lancer('contact', contact);
    for (const instance of [m.siege.id, m.a.id]) {
      const e = await journalDe(instance, 'transfert.copie');
      expect(JSON.stringify(e)).toContain(r.racine.id);
    }
  });

  it('annule tout si la dernière écriture échoue', async () => {
    const contact = await f.contact(m.siege, 'Annulé Fictif');
    const tache = await f.tache(m.siege, 'Annulée', { contact });
    await t.owner.pool.query(`
      create function refuse_journal() returns trigger language plpgsql as
        $$ begin raise exception 'panne simulée'; end $$;
      create trigger panne before insert on journal
        for each row when (new.action = 'transfert.deplace') execute function refuse_journal();
    `);
    try {
      const erreur = await lancer('contact', contact).catch((e: unknown) => e);
      expect(String((erreur as Error).cause)).toContain('panne simulée');
    } finally {
      await t.owner.pool.query('drop trigger panne on journal; drop function refuse_journal();');
    }
    expect(await f.instanceDe('contacts', contact)).toBe(m.siege.id);
    expect(await f.instanceDe('taches', tache)).toBe(m.siege.id);
    const n = await t.owner.pool.query('select 1 from activites where contact_id = $1', [contact]);
    expect(n.rowCount).toBe(0);
  });

  it('laisse un seul de deux transferts simultanés réussir', async () => {
    const contact = await f.contact(m.siege, 'Course Fictive');
    const resultats = await Promise.allSettled([
      lancer('contact', contact),
      lancer('contact', contact),
    ]);
    const ok = resultats.filter((r) => r.status === 'fulfilled');
    const ko = resultats.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(ko[0]?.reason).toBeInstanceOf(RacineIntrouvable);
    const n = await t.owner.pool.query("select 1 from contacts where nom = 'Course Fictive'");
    expect(n.rowCount).toBe(1);
  });

  it('refuse sans rien écrire une cible identique ou archivée', async () => {
    const contact = await f.contact(m.siege, 'Refus Fictif');
    await expect(lancer('contact', contact, m.siege.id)).rejects.toBeInstanceOf(TransfertRefuse);
    await t.owner.db.update(instances).set({ statut: 'archive' }).where(eq(instances.id, m.b.id));
    await expect(lancer('contact', contact, m.b.id)).rejects.toBeInstanceOf(TransfertRefuse);
    expect(await f.instanceDe('contacts', contact)).toBe(m.siege.id);
  });
});
