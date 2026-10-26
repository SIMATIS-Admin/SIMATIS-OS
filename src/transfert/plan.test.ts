import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { creerMonde, fabrique, type Monde } from '../../test/transfert.js';
import { instances } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { planifierTransfert, RacineIntrouvable, TransfertRefuse } from './plan.js';
import type { Exclusions, Ref } from './types.js';

describe('planifierTransfert', () => {
  let t: TestApp;
  let m: Monde;
  let f: ReturnType<typeof fabrique>;

  beforeAll(async () => {
    t = await setupTestApp();
    m = await creerMonde(t);
    f = fabrique(t);
  });
  afterAll(() => t.drop());

  const plan = (racine: Ref, exclusions: Exclusions = []) =>
    planifierTransfert(t.owner.db, {
      instanceOrigine: m.siege.id,
      cible: m.a.id,
      racine,
      exclusions,
    });
  const cles = (n: { noeuds: Ref[] }) => n.noeuds.map((x) => `${x.type}:${x.id}`).sort();

  it('planifie une affaire native : tâche obligatoire, contact proposé, tout déplacé', async () => {
    const contact = await f.contact(m.siege, 'Contact Fictif');
    const affaire = await f.affaire(m.siege, 'Affaire Fictive');
    const tache = await f.tache(m.siege, 'Relance fictive', { opportunite: affaire });
    await f.lierAffaireContact(m.siege, affaire, contact);
    const a = await plan({ type: 'affaire', id: affaire });
    expect(cles(a)).toEqual([`affaire:${affaire}`, `contact:${contact}`, `tache:${tache}`].sort());
    expect(a.noeuds.every((n) => n.mode === 'deplace')).toBe(true);
    expect(a.noeuds.find((n) => n.type === 'tache')?.obligatoire).toBe(true);
    expect(a.noeuds.find((n) => n.type === 'contact')?.obligatoire).toBe(false);
    expect(a.racine.id).toBe(affaire);
  });

  it('copie un contact miroir et, avec lui, ses tâches natives', async () => {
    const contact = await f.contact(m.siege, 'Miroir Fictif', 'hubspot', 'h-1');
    const tache = await f.tache(m.siege, 'Tâche native', { contact });
    const a = await plan({ type: 'contact', id: contact });
    expect(a.racine.mode).toBe('copie');
    expect(a.noeuds.find((n) => n.id === tache)?.mode).toBe('copie');
  });

  it('déplace un contact natif mais copie son entreprise miroir', async () => {
    const entreprise = await f.entreprise(m.siege, 'Société Miroir', 'hubspot', 'h-2');
    const contact = await f.contact(m.siege, 'Contact Natif');
    await t.owner.pool.query('update contacts set entreprise_id = $1 where id = $2', [
      entreprise,
      contact,
    ]);
    const a = await plan({ type: 'contact', id: contact });
    expect(a.racine.mode).toBe('deplace');
    expect(a.noeuds.find((n) => n.id === entreprise)?.mode).toBe('copie');
  });

  it('retire le lien d’un objet exclu et le dit', async () => {
    const contact = await f.contact(m.siege, 'Exclu Fictif');
    const tache = await f.tache(m.siege, 'Tâche liée', { contact });
    const a = await plan({ type: 'tache', id: tache }, [{ type: 'contact', id: contact }]);
    expect(cles(a)).toEqual([`tache:${tache}`]);
    expect(a.liensRetires.join(' ')).toContain('Exclu Fictif');
  });

  it('termine sur un graphe cyclique, chaque objet une fois', async () => {
    const contact = await f.contact(m.siege, 'Cycle C');
    const entreprise = await f.entreprise(m.siege, 'Cycle E');
    const affaire = await f.affaire(m.siege, 'Cycle A');
    await t.owner.pool.query('update contacts set entreprise_id = $1 where id = $2', [
      entreprise,
      contact,
    ]);
    await t.owner.pool.query(
      'update opportunites set entreprise_id = $1, contact_id = $2 where id = $3',
      [entreprise, contact, affaire],
    );
    const tache = await f.tache(m.siege, 'Cycle T', { opportunite: affaire, contact, entreprise });
    const a = await plan({ type: 'affaire', id: affaire });
    const toutes = cles(a);
    expect(new Set(toutes).size).toBe(toutes.length);
    expect(toutes).toContain(`tache:${tache}`);
  });

  it('refuse une cible identique, inconnue ou archivée, et une racine d’une autre instance', async () => {
    const contact = await f.contact(m.siege, 'Refus Fictif');
    const base = {
      instanceOrigine: m.siege.id,
      racine: { type: 'contact' as const, id: contact },
      exclusions: [],
    };
    await expect(
      planifierTransfert(t.owner.db, { ...base, cible: m.siege.id }),
    ).rejects.toBeInstanceOf(TransfertRefuse);
    await expect(
      planifierTransfert(t.owner.db, { ...base, cible: '00000000-0000-4000-8000-000000000000' }),
    ).rejects.toBeInstanceOf(TransfertRefuse);
    await t.owner.db.update(instances).set({ statut: 'archive' }).where(eq(instances.id, m.b.id));
    await expect(planifierTransfert(t.owner.db, { ...base, cible: m.b.id })).rejects.toBeInstanceOf(
      TransfertRefuse,
    );
    await expect(
      planifierTransfert(t.owner.db, { ...base, instanceOrigine: m.a.id, cible: m.siege.id }),
    ).rejects.toBeInstanceOf(RacineIntrouvable);
  });

  it('refuse une démonstration comme origine ou comme cible', async () => {
    const demo = await createInstance(t.owner.db, {
      slug: 'demo-x',
      nom: 'Démo X',
      type: 'prospect',
    });
    const contact = await f.contact(m.siege, 'Démo Fictif');
    const base = { racine: { type: 'contact' as const, id: contact }, exclusions: [] };
    await expect(
      planifierTransfert(t.owner.db, { ...base, instanceOrigine: m.siege.id, cible: demo.id }),
    ).rejects.toBeInstanceOf(TransfertRefuse);
    const dedans = await f.contact(demo, 'Fictif de démo');
    await expect(
      planifierTransfert(t.owner.db, {
        instanceOrigine: demo.id,
        cible: m.a.id,
        racine: { type: 'contact', id: dedans },
        exclusions: [],
      }),
    ).rejects.toBeInstanceOf(TransfertRefuse);
  });

  it('avertit : rendez-vous copié et clé d’entrée déjà prise dans la cible', async () => {
    const rdv = await f.rdv(m.siege, 'Rdv Fictif', 'google');
    const a1 = await plan({ type: 'rdv', id: rdv });
    expect(a1.avertissements.join(' ')).toContain('agenda');

    const sujet = await f.sujet(m.siege, 'Entrée Fictive', { sourceId: 'cle-1' });
    await f.sujet(m.a, 'Déjà là', { sourceId: 'cle-1' });
    const a2 = await plan({ type: 'sujet', id: sujet });
    expect(a2.avertissements.join(' ')).toContain('clé');
  });

  it('signale une copie déjà faite d’après le journal de la cible', async () => {
    const contact = await f.contact(m.siege, 'Déjà Copié', 'hubspot', 'h-9');
    await t.owner.pool.query(
      `insert into journal (instance_id, acteur, action, details) values ($1, 'pilote', 'transfert.copie', $2::jsonb)`,
      [
        m.a.id,
        JSON.stringify({
          copies: [
            { type: 'contact', origineInstance: m.siege.id, origineId: contact, copieId: 'x-1' },
          ],
        }),
      ],
    );
    const a = await plan({ type: 'contact', id: contact });
    expect(a.copieExistante).toEqual({ type: 'contact', id: 'x-1' });
  });

  it('prévient quand un objet resté sur place perd son lien vers un objet déplacé', async () => {
    const contact = await f.contact(m.siege, 'Partagé Fictif');
    const autre = await f.tache(m.siege, 'Reste sur place', { contact });
    const aff = await f.affaire(m.siege, 'Affaire déplacée');
    await f.lierAffaireContact(m.siege, aff, contact);
    const a = await plan({ type: 'affaire', id: aff }, []);
    // the contact is offered and moved, so its other referrers left behind are reported
    expect(a.noeuds.some((n) => n.id === contact)).toBe(true);
    expect(a.noeuds.some((n) => n.id === autre)).toBe(false);
    expect(a.liensRetires.join(' ')).toContain('Reste sur place');
  });
});
