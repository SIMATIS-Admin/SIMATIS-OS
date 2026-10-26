import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { creerMonde, fabrique, liensCroises, type Monde } from '../../test/transfert.js';
import { executerTransfert } from './executer.js';
import { planifierTransfert, TransfertRefuse } from './plan.js';
import type { Exclusions, TypeObjet } from './types.js';

// Findings of the final review, with data shaped like the real thing: an entry comes from a
// routine, a deal task from HubSpot, a meeting from Google.
describe('transfert : corrections de la revue', () => {
  let t: TestApp;
  let m: Monde;
  let f: ReturnType<typeof fabrique>;

  beforeAll(async () => {
    t = await setupTestApp();
    m = await creerMonde(t);
    f = fabrique(t);
  });
  afterAll(() => t.drop());

  const demande = (type: TypeObjet, id: string, exclusions: Exclusions = []) => ({
    instanceOrigine: m.siege.id,
    cible: m.a.id,
    racine: { type, id },
    exclusions,
  });
  const lancer = (type: TypeObjet, id: string, exclusions: Exclusions = []) =>
    executerTransfert(t.owner.db, demande(type, id, exclusions));
  const lignes = async (sql: string, params: unknown[]) =>
    (await t.owner.pool.query(sql, params)).rows as Record<string, string | null>[];

  it('garde, sur la copie, le lien vers un objet déplacé, et coupe celui de l’original', async () => {
    const contact = await f.contact(m.siege, 'Natif Fictif');
    const tacheMiroir = await f.tache(m.siege, 'Tâche HubSpot', { contact });
    await t.owner.pool.query(
      "update taches set source = 'hubspot', source_id = 'h-t1' where id = $1",
      [tacheMiroir],
    );
    const r = await lancer('contact', contact);
    expect(r).toMatchObject({ deplaces: 1, copies: 1 });
    const originale = (
      await lignes('select contact_id, instance_id from taches where id = $1', [tacheMiroir])
    )[0];
    expect(originale).toEqual({ contact_id: null, instance_id: m.siege.id });
    const copie = (
      await lignes(
        "select contact_id from taches where instance_id = $1 and titre = 'Tâche HubSpot'",
        [m.a.id],
      )
    )[0];
    expect(copie?.contact_id).toBe(contact);
    expect(await liensCroises(t)).toBe(0);
  });

  it('déplace une entrée venue d’une routine avec son contact natif', async () => {
    const contact = await f.contact(m.siege, 'Contact Entrée');
    const sujet = await f.sujet(m.siege, 'Entrée routine', { contact });
    const r = await lancer('contact', contact);
    expect(r).toMatchObject({ deplaces: 2, copies: 0 });
    expect(await f.instanceDe('sujets', sujet)).toBe(m.a.id);
    expect(await liensCroises(t)).toBe(0);
  });

  it('copie un rendez-vous Google et déplace un rendez-vous déjà détaché', async () => {
    const google = await f.rdv(m.siege, 'Bloc Google');
    const detache = await f.rdv(m.siege, 'Bloc Détaché', true);
    expect(await lancer('rdv', google)).toMatchObject({ deplaces: 0, copies: 1 });
    expect(await f.instanceDe('rendez_vous', google)).toBe(m.siege.id);
    expect(await lancer('rdv', detache)).toMatchObject({ deplaces: 1, copies: 0 });
    expect(await f.instanceDe('rendez_vous', detache)).toBe(m.a.id);
  });

  it('détache aussi la liaison copiée de son outil d’origine', async () => {
    const contact = await f.contact(m.siege, 'Contact Liaison', 'hubspot', 'h-l1');
    const affaire = await f.affaire(m.siege, 'Affaire Liaison', 'hubspot', 'h-l2');
    await f.lierAffaireContact(m.siege, affaire, contact, 'hubspot');
    const r = await lancer('affaire', affaire);
    const l = await lignes(
      'select source, source_id from affaire_contacts where opportunite_id = $1',
      [r.racine.id],
    );
    expect(l).toEqual([{ source: 'natif', source_id: null }]);
  });

  it('ne laisse pas deux transferts de racines différentes se croiser', async () => {
    const contact = await f.contact(m.siege, 'Course Contact');
    const affaire = await f.affaire(m.siege, 'Course Affaire');
    await f.lierAffaireContact(m.siege, affaire, contact);
    const res = await Promise.allSettled([
      executerTransfert(t.owner.db, { ...demande('affaire', affaire) }),
      executerTransfert(t.owner.db, { ...demande('contact', contact), cible: m.b.id }),
    ]);
    expect(res.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(await liensCroises(t)).toBe(0);
  });

  it('coupe les liens des tables hors registre et le dit dans l’aperçu', async () => {
    const contact = await f.contact(m.siege, 'Contact Agenda');
    await f.rdvLien(m.siege, contact);
    const apercu = await planifierTransfert(t.owner.db, demande('contact', contact));
    expect(apercu.liensRetires.join(' ')).toContain('Contact Agenda');
    await lancer('contact', contact);
    expect(
      (await lignes('select contact_id from rdv_liens where event_id = $1', ['ev-lien']))[0]
        ?.contact_id,
    ).toBeNull();
    expect(await liensCroises(t)).toBe(0);
  });

  it('refuse de déplacer une affaire qui a un devis', async () => {
    const affaire = await f.affaire(m.siege, 'Affaire avec devis');
    await f.devis(m.siege, affaire);
    await expect(lancer('affaire', affaire)).rejects.toBeInstanceOf(TransfertRefuse);
    expect(await f.instanceDe('opportunites', affaire)).toBe(m.siege.id);
  });

  it('emmène avec un objet proposé ses objets obligatoires, et coupe ses autres liens', async () => {
    const entreprise = await f.entreprise(m.siege, 'Entreprise Laissée');
    const contact = await f.contact(m.siege, 'Contact Suiveur');
    await t.owner.pool.query('update contacts set entreprise_id = $1 where id = $2', [
      entreprise,
      contact,
    ]);
    const tacheDuContact = await f.tache(m.siege, 'Tâche du contact', { contact });
    const affaire = await f.affaire(m.siege, 'Affaire Porteuse');
    await f.lierAffaireContact(m.siege, affaire, contact);
    const apercu = await planifierTransfert(
      t.owner.db,
      demande('affaire', affaire, [{ type: 'entreprise', id: entreprise }]),
    );
    expect(apercu.noeuds.some((n) => n.id === tacheDuContact)).toBe(true);
    await lancer('affaire', affaire, [{ type: 'entreprise', id: entreprise }]);
    expect(await f.instanceDe('taches', tacheDuContact)).toBe(m.a.id);
    expect(
      (await lignes('select entreprise_id from contacts where id = $1', [contact]))[0]
        ?.entreprise_id,
    ).toBeNull();
    expect(await f.instanceDe('entreprises', entreprise)).toBe(m.siege.id);
    expect(await liensCroises(t)).toBe(0);
  });

  it('ignore l’exclusion d’un objet qui suit obligatoirement', async () => {
    const affaire = await f.affaire(m.siege, 'Affaire Obligée');
    const tache = await f.tache(m.siege, 'Tâche obligatoire', { opportunite: affaire });
    const apercu = await planifierTransfert(
      t.owner.db,
      demande('affaire', affaire, [{ type: 'tache', id: tache }]),
    );
    expect(apercu.noeuds.some((n) => n.id === tache)).toBe(true);
  });

  it('remet à zéro le report au second cerveau d’une entrée copiée', async () => {
    const contact = await f.contact(m.siege, 'Contact Miroir Entrée', 'hubspot', 'h-s1');
    await f.sujet(m.siege, 'Entrée déjà reportée', { contact, reporte: true });
    await lancer('contact', contact);
    const r = await lignes(
      "select reporte_at from sujets where instance_id = $1 and titre = 'Entrée déjà reportée'",
      [m.a.id],
    );
    expect(r[0]?.reporte_at).toBeNull();
  });
});
