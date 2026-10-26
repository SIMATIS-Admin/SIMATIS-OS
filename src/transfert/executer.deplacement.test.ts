import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { creerMonde, fabrique, liensCroises, type Monde } from '../../test/transfert.js';
import { executerTransfert } from './executer.js';
import type { TypeObjet } from './types.js';

describe('executerTransfert : déplacement', () => {
  let t: TestApp;
  let m: Monde;
  let f: ReturnType<typeof fabrique>;

  beforeAll(async () => {
    t = await setupTestApp();
    m = await creerMonde(t);
    f = fabrique(t);
  });
  afterAll(() => t.drop());

  const deplacer = (
    type: TypeObjet,
    id: string,
    exclusions: { type: TypeObjet; id: string }[] = [],
  ) =>
    executerTransfert(t.owner.db, {
      instanceOrigine: m.siege.id,
      cible: m.a.id,
      racine: { type, id },
      exclusions,
    });

  it('déplace une affaire native avec sa tâche et son contact proposé', async () => {
    const contact = await f.contact(m.siege, 'Contact Fictif');
    const affaire = await f.affaire(m.siege, 'Affaire Fictive');
    const tache = await f.tache(m.siege, 'Relance fictive', { opportunite: affaire });
    await f.lierAffaireContact(m.siege, affaire, contact);
    const r = await deplacer('affaire', affaire);
    expect(r.deplaces).toBe(3);
    expect(r.copies).toBe(0);
    expect(r.racine).toEqual({ type: 'affaire', id: affaire, instance: m.a.id });
    expect(await f.instanceDe('opportunites', affaire)).toBe(m.a.id);
    expect(await f.instanceDe('taches', tache)).toBe(m.a.id);
    expect(await f.instanceDe('contacts', contact)).toBe(m.a.id);
    expect(await liensCroises(t)).toBe(0);
  });

  it('garde la liaison et le lien principal de l’affaire', async () => {
    const contact = await f.contact(m.siege, 'Principal Fictif');
    const affaire = await f.affaire(m.siege, 'Affaire principale');
    await t.owner.pool.query('update opportunites set contact_id = $1 where id = $2', [
      contact,
      affaire,
    ]);
    await f.lierAffaireContact(m.siege, affaire, contact);
    await deplacer('affaire', affaire);
    const r = await t.owner.pool.query<{ instance_id: string; principal: boolean }>(
      'select instance_id, principal from affaire_contacts where opportunite_id = $1',
      [affaire],
    );
    expect(r.rows.map((x) => x.instance_id)).toEqual([m.a.id]);
    const o = await t.owner.pool.query<{ contact_id: string }>(
      'select contact_id from opportunites where id = $1',
      [affaire],
    );
    expect(o.rows[0]?.contact_id).toBe(contact);
  });

  it('emporte les activités et note le déplacement dans l’historique', async () => {
    const contact = await f.contact(m.siege, 'Historique Fictif');
    const note = await f.activite(m.siege, { contact });
    await deplacer('contact', contact);
    expect(await f.instanceDe('activites', note)).toBe(m.a.id);
    const h = await t.owner.pool.query<{ titre: string }>(
      'select titre from activites where contact_id = $1 and instance_id = $2',
      [contact, m.a.id],
    );
    expect(h.rows.map((x) => x.titre).join(' ')).toContain('Déplacé depuis l’instance Siège');
  });

  it('suffixe la clé d’une entrée dont la clé existe déjà dans la cible', async () => {
    const sujet = await f.sujet(m.siege, 'Entrée fictive', { sourceId: 'cle-pareille' });
    await f.sujet(m.a, 'Déjà là', { sourceId: 'cle-pareille' });
    await deplacer('sujet', sujet);
    const r = await t.owner.pool.query<{ source_id: string; instance_id: string }>(
      'select source_id, instance_id from sujets where id = $1',
      [sujet],
    );
    expect(r.rows[0]).toEqual({
      source_id: `cle-pareille:transfert-${sujet}`,
      instance_id: m.a.id,
    });
  });

  it('retire le lien vers un objet exclu ; un contact proposé emmène ses tâches', async () => {
    const contact = await f.contact(m.siege, 'Exclu Fictif');
    const tache = await f.tache(m.siege, 'Tâche liée', { contact });
    await deplacer('tache', tache, [{ type: 'contact', id: contact }]);
    const r = await t.owner.pool.query<{ contact_id: string | null; instance_id: string }>(
      'select contact_id, instance_id from taches where id = $1',
      [tache],
    );
    expect(r.rows[0]).toEqual({ contact_id: null, instance_id: m.a.id });

    // An offered contact brings its own tasks, so nothing is left pointing across instances.
    const partage = await f.contact(m.siege, 'Partagé Fictif');
    const suit = await f.tache(m.siege, 'Suit le contact', { contact: partage });
    const aff = await f.affaire(m.siege, 'Affaire emporte contact');
    await f.lierAffaireContact(m.siege, aff, partage);
    await deplacer('affaire', aff);
    const s = await t.owner.pool.query<{ contact_id: string | null; instance_id: string }>(
      'select contact_id, instance_id from taches where id = $1',
      [suit],
    );
    expect(s.rows[0]).toEqual({ contact_id: partage, instance_id: m.a.id });
    expect(await liensCroises(t)).toBe(0);
  });
});
