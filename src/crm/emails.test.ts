import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import {
  ajouterEmail,
  contactsParEmails,
  definirEmailPrincipal,
  emailsDuContact,
  retirerEmail,
} from './emails.js';
import { FicheInvalide } from './fiches.js';
import { searchContacts } from './service.js';

describe('Adresses email d’un contact', () => {
  let t: TestApp;
  let a: Instance;
  let b: Instance;

  const contact = async (i: Instance, nom: string, email: string | null = null) =>
    (
      await t.owner.pool.query<{ id: string }>(
        'insert into contacts (instance_id, nom, email) values ($1, $2, $3) returning id',
        [i.id, nom, email],
      )
    ).rows[0]!.id;
  const adresses = (i: Instance, id: string) =>
    withInstance(t.app.db, i.id, (tx) => emailsDuContact(tx, id));
  const colonne = async (id: string) =>
    (
      await t.owner.pool.query<{ email: string | null }>(
        'select email from contacts where id = $1',
        [id],
      )
    ).rows[0]!.email;

  beforeAll(async () => {
    t = await setupTestApp();
    a = await createInstance(t.owner.db, { slug: 'emails-a', nom: 'A', type: 'mandat' });
    b = await createInstance(t.owner.db, { slug: 'emails-b', nom: 'B', type: 'mandat' });
  });
  afterAll(() => t.drop());

  it('un contact créé avec un email l’a comme adresse principale', async () => {
    const id = await contact(a, 'Contact Fictif', 'Premier@Exemple.test');
    expect(await adresses(a, id)).toEqual([{ email: 'premier@exemple.test', principal: true }]);
  });

  it('ajoute des adresses secondaires, la première devient principale', async () => {
    const id = await contact(a, 'Sans Adresse');
    expect(await ajouterEmail(t.app.db, a, id, ' Un@Exemple.test ')).toEqual([
      { email: 'un@exemple.test', principal: true },
    ]);
    expect(await colonne(id)).toBe('un@exemple.test');
    const apres = await ajouterEmail(t.app.db, a, id, 'deux@exemple.test');
    expect(apres).toEqual([
      { email: 'un@exemple.test', principal: true },
      { email: 'deux@exemple.test', principal: false },
    ]);
    expect(await colonne(id)).toBe('un@exemple.test');
  });

  it('refuse une adresse invalide ou déjà présente', async () => {
    const id = await contact(a, 'Doublon', 'x@exemple.test');
    await expect(ajouterEmail(t.app.db, a, id, 'pas-un-email')).rejects.toBeInstanceOf(
      FicheInvalide,
    );
    await expect(ajouterEmail(t.app.db, a, id, 'X@exemple.test')).rejects.toBeInstanceOf(
      FicheInvalide,
    );
  });

  it('change l’adresse principale et la recopie dans contacts.email', async () => {
    const id = await contact(a, 'Bascule', 'a@exemple.test');
    await ajouterEmail(t.app.db, a, id, 'b@exemple.test');
    const apres = await definirEmailPrincipal(t.app.db, a, id, 'b@exemple.test');
    expect(apres).toEqual([
      { email: 'b@exemple.test', principal: true },
      { email: 'a@exemple.test', principal: false },
    ]);
    expect(await colonne(id)).toBe('b@exemple.test');
    await expect(
      definirEmailPrincipal(t.app.db, a, id, 'inconnue@exemple.test'),
    ).rejects.toBeInstanceOf(FicheInvalide);
  });

  it('retirer la principale promeut la suivante, retirer la dernière vide l’email', async () => {
    const id = await contact(a, 'Retrait', 'a@exemple.test');
    await ajouterEmail(t.app.db, a, id, 'b@exemple.test');
    expect(await retirerEmail(t.app.db, a, id, 'a@exemple.test')).toEqual([
      { email: 'b@exemple.test', principal: true },
    ]);
    expect(await colonne(id)).toBe('b@exemple.test');
    expect(await retirerEmail(t.app.db, a, id, 'b@exemple.test')).toEqual([]);
    expect(await colonne(id)).toBeNull();
  });

  it('la synchro de contacts.email met à jour la ligne principale', async () => {
    const id = await contact(a, 'Synchro', 'ancien@exemple.test');
    await t.owner.pool.query('update contacts set email = $2 where id = $1', [
      id,
      'nouveau@exemple.test',
    ]);
    expect(await adresses(a, id)).toEqual([
      { email: 'nouveau@exemple.test', principal: true },
      { email: 'ancien@exemple.test', principal: false },
    ]);
  });

  it('retrouve un contact par une adresse secondaire, dans sa seule instance', async () => {
    const id = await contact(a, 'Recherche', 'p@exemple.test');
    await ajouterEmail(t.app.db, a, id, 'S@exemple.test');
    const autre = await contact(b, 'Autre instance', 's@exemple.test');
    const trouves = await withInstance(t.app.db, a.id, (tx) =>
      contactsParEmails(tx, ['s@EXEMPLE.test', 'inconnu@exemple.test']),
    );
    expect(trouves.get('s@exemple.test')).toBe(id);
    expect(trouves.size).toBe(1);
    expect(autre).not.toBe(id);
  });

  it('la recherche de contacts trouve une adresse secondaire', async () => {
    const id = await contact(a, 'Cherché', 'principale@exemple.test');
    await ajouterEmail(t.app.db, a, id, 'rare-secondaire@exemple.test');
    const trouves = await searchContacts(t.app.db, a.id, 'rare-secondaire');
    expect(trouves.map((c) => c.id)).toEqual([id]);
  });

  it('renvoie null pour un contact d’une autre instance', async () => {
    const id = await contact(b, 'Chez B');
    expect(await ajouterEmail(t.app.db, a, id, 'x@exemple.test')).toBeNull();
  });
});
