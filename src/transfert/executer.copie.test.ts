import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { creerMonde, fabrique, liensCroises, type Monde } from '../../test/transfert.js';
import { CopieDejaFaite, executerTransfert } from './executer.js';
import type { TypeObjet } from './types.js';

describe('executerTransfert : copie des miroirs', () => {
  let t: TestApp;
  let m: Monde;
  let f: ReturnType<typeof fabrique>;

  beforeAll(async () => {
    t = await setupTestApp();
    m = await creerMonde(t);
    f = fabrique(t);
  });
  afterAll(() => t.drop());

  const transferer = (type: TypeObjet, id: string, extra: { copierQuandMeme?: boolean } = {}) =>
    executerTransfert(t.owner.db, {
      instanceOrigine: m.siege.id,
      cible: m.a.id,
      racine: { type, id },
      exclusions: [],
      ...extra,
    });
  const lignes = async (sql: string, params: unknown[]) =>
    (await t.owner.pool.query(sql, params)).rows as Record<string, string | null>[];

  it('copie un contact miroir, détaché de l’outil, et laisse l’original', async () => {
    const contact = await f.contact(m.siege, 'Miroir Fictif', 'hubspot', 'h-1');
    const r = await transferer('contact', contact);
    expect(r).toMatchObject({ deplaces: 0, copies: 1 });
    expect(r.racine.id).not.toBe(contact);
    expect(await f.instanceDe('contacts', contact)).toBe(m.siege.id);
    const copie = (await lignes('select * from contacts where id = $1', [r.racine.id]))[0];
    expect(copie).toMatchObject({
      instance_id: m.a.id,
      source: 'natif',
      source_id: null,
      nom: 'Miroir Fictif',
    });
    const original = (
      await lignes('select source, source_id from contacts where id = $1', [contact])
    )[0];
    expect(original).toEqual({ source: 'hubspot', source_id: 'h-1' });
  });

  it('relie les copies entre elles, jamais à l’original', async () => {
    const contact = await f.contact(m.siege, 'Contact Miroir', 'hubspot', 'h-2');
    const affaire = await f.affaire(m.siege, 'Affaire Miroir', 'hubspot', 'h-3');
    await t.owner.pool.query('update opportunites set contact_id = $1 where id = $2', [
      contact,
      affaire,
    ]);
    await f.lierAffaireContact(m.siege, affaire, contact);
    const r = await transferer('affaire', affaire);
    expect(r.copies).toBe(2);
    const copie = (
      await lignes('select contact_id from opportunites where id = $1', [r.racine.id])
    )[0];
    expect(copie?.contact_id).not.toBeNull();
    expect(copie?.contact_id).not.toBe(contact);
    expect(await f.instanceDe('contacts', copie?.contact_id as string)).toBe(m.a.id);
    const liaison = await lignes(
      'select instance_id, contact_id from affaire_contacts where opportunite_id = $1',
      [r.racine.id],
    );
    expect(liaison).toEqual([{ instance_id: m.a.id, contact_id: copie?.contact_id }]);
    const originale = await lignes(
      'select instance_id from affaire_contacts where opportunite_id = $1',
      [affaire],
    );
    expect(originale).toEqual([{ instance_id: m.siege.id }]);
    expect(await liensCroises(t)).toBe(0);
  });

  it('note l’origine dans l’historique de la copie et copie les activités', async () => {
    const contact = await f.contact(m.siege, 'Historique Miroir', 'hubspot', 'h-4');
    const note = await f.activite(m.siege, { contact });
    const r = await transferer('contact', contact);
    const h = await lignes('select titre, resume from activites where contact_id = $1', [
      r.racine.id,
    ]);
    expect(h.map((x) => x.titre).join(' ')).toContain('Créé depuis l’instance Siège');
    expect(h.map((x) => x.resume).join(' ')).toContain('Historique Miroir');
    expect(await f.instanceDe('activites', note)).toBe(m.siege.id);
    expect(h).toHaveLength(2);
  });

  it('copie un rendez-vous : lien agenda coupé, compte rendu et liens conservés', async () => {
    const rdv = await f.rdv(m.siege, 'Rdv Miroir', 'google');
    await t.owner.pool.query(
      "update rendez_vous set compte_rendu = 'Compte rendu fictif' where id = $1",
      [rdv],
    );
    const contact = await f.contact(m.siege, 'Invité Fictif');
    await f.lierRdvContact(m.siege, rdv, contact);
    const r = await transferer('rdv', rdv);
    const copie = (
      await lignes('select event_id, compte_rendu, instance_id from rendez_vous where id = $1', [
        r.racine.id,
      ])
    )[0];
    expect(copie).toEqual({
      event_id: `copie:${r.racine.id}`,
      compte_rendu: 'Compte rendu fictif',
      instance_id: m.a.id,
    });
    const liens = await lignes('select contact_id from rdv_contacts where rendez_vous_id = $1', [
      r.racine.id,
    ]);
    expect(liens).toHaveLength(1);
    expect(liens[0]?.contact_id).not.toBe(contact);
  });

  it('déplace un contact natif et lui relie la copie de son entreprise miroir', async () => {
    const entreprise = await f.entreprise(m.siege, 'Société Miroir', 'hubspot', 'h-5');
    const contact = await f.contact(m.siege, 'Contact Natif');
    await t.owner.pool.query('update contacts set entreprise_id = $1 where id = $2', [
      entreprise,
      contact,
    ]);
    const r = await transferer('contact', contact);
    expect(r).toMatchObject({ deplaces: 1, copies: 1 });
    const c = (
      await lignes('select entreprise_id, instance_id from contacts where id = $1', [contact])
    )[0];
    expect(c?.instance_id).toBe(m.a.id);
    expect(c?.entreprise_id).not.toBe(entreprise);
    expect(await f.instanceDe('entreprises', c?.entreprise_id as string)).toBe(m.a.id);
    expect(await f.instanceDe('entreprises', entreprise)).toBe(m.siege.id);
    expect(await liensCroises(t)).toBe(0);
  });

  it('refuse une copie déjà faite, sauf demande explicite', async () => {
    const contact = await f.contact(m.siege, 'Deux Fois', 'hubspot', 'h-6');
    const premiere = await transferer('contact', contact);
    const erreur = await transferer('contact', contact).catch((e: unknown) => e);
    expect(erreur).toBeInstanceOf(CopieDejaFaite);
    expect((erreur as CopieDejaFaite).noeud).toEqual({ type: 'contact', id: premiere.racine.id });
    const seconde = await transferer('contact', contact, { copierQuandMeme: true });
    expect(seconde.racine.id).not.toBe(premiere.racine.id);
    const n = await lignes("select id from contacts where instance_id = $1 and nom = 'Deux Fois'", [
      m.a.id,
    ]);
    expect(n).toHaveLength(2);
  });

  it('garde la trace de chaque copie dans le journal de la cible', async () => {
    const contact = await f.contact(m.siege, 'Tracé Fictif', 'hubspot', 'h-7');
    const r = await transferer('contact', contact);
    const j = await t.owner.pool.query<{ details: { copies: unknown[] } }>(
      "select details from journal where instance_id = $1 and action = 'transfert.copie'",
      [m.a.id],
    );
    const toutes = j.rows.flatMap((x) => x.details.copies);
    expect(toutes).toContainEqual({
      type: 'contact',
      origineInstance: m.siege.id,
      origineId: contact,
      copieId: r.racine.id,
    });
  });
});
