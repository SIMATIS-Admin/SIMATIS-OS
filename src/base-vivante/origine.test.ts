import { afterAll, beforeAll, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { insererFiche } from '../../test/fiche-base.js';
import { createInstance } from '../instances/service.js';
import { clesDoublon, normaliserFiche } from './nettoyage.js';
import { lireOrigine, noterContactsRecherches } from './origine.js';

let t: TestApp;
beforeAll(async () => {
  t = await setupTestApp();
});
afterAll(async () => {
  await t.drop();
});
it('conserve le contexte après import, sans doublon ni mélange entre instances', async () => {
  const a = await createInstance(t.owner.db, {
    slug: 'origine-a',
    nom: 'Atelier fictif A',
    type: 'mandat',
  });
  const b = await createInstance(t.owner.db, {
    slug: 'origine-b',
    nom: 'Atelier fictif B',
    type: 'mandat',
  });
  const contact = {
    entreprise: 'Atelier fictif',
    prenom: 'Alice',
    nom: 'Exemple',
    email: 'alice@atelier.example',
    linkedin: null,
    qualification: 'PME fictive ; données datées et sourcées.',
    source: 'https://atelier.example/equipe',
  };
  const fiche = normaliserFiche(contact).fiche;
  const id = await insererFiche(t.owner.db, {
    instanceId: a.id,
    zone: 'prospectable',
    entreprise: contact.entreprise,
    prenom: contact.prenom,
    nom: contact.nom,
    email: contact.email,
    provenance: 'Recherche Codex',
    cles: clesDoublon(fiche),
  });
  await noterContactsRecherches(t.app.db, a.id, [contact]);
  await noterContactsRecherches(t.app.db, a.id, [contact]);
  const origine = await lireOrigine(t.app.db, a.id, id);
  expect(origine?.notes).toHaveLength(1);
  expect(origine?.notes[0]?.texte).toBe(contact.qualification);
  expect(origine?.notes[0]?.source).toBe(contact.source);
  expect(await lireOrigine(t.app.db, b.id, id)).toBeNull();
});
