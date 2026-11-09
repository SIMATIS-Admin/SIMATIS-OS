import { afterAll, beforeAll, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { createInstance } from '../instances/service.js';
import { withInstance } from '../db/context.js';
import { insererFiche } from '../../test/fiche-base.js';
import { enrichissementSuggestions, enrichissementTaches } from './schema.js';
import {
  cloreSessionRecherche,
  commenterSession,
  contactsDeSession,
  dernieresSessions,
  noterIntegrationSession,
  ouvrirSessionRecherche,
  supprimerSession,
} from './sessions.js';

let t: TestApp;
beforeAll(async () => {
  t = await setupTestApp();
});
afterAll(async () => {
  await t.drop();
});

it('réunit recherches et enrichissements, isolés par instance, du plus récent au plus ancien', async () => {
  const a = await createInstance(t.owner.db, { slug: 'sess-a', nom: 'A', type: 'propre' });
  const b = await createInstance(t.owner.db, { slug: 'sess-b', nom: 'B', type: 'propre' });
  await withInstance(t.app.db, a.id, (tx) =>
    tx.insert(enrichissementTaches).values({
      instanceId: a.id,
      type: 'completer',
      profil: [],
      maxParEntreprise: 1,
      etat: 'interrompue',
      erreur: 'Quota atteint',
    }),
  );
  const id = await ouvrirSessionRecherche(t.app.db, a.id, { mode: 'manuel', nombreVise: 10 });
  expect((await dernieresSessions(t.app.db, a.id))[0]).toMatchObject({
    id,
    etat: 'en_cours',
    mode: 'manuel',
  });
  await cloreSessionRecherche(t.app.db, a.id, id, { etat: 'terminee', trouves: 10 });

  const sessions = await dernieresSessions(t.app.db, a.id);
  expect(sessions.map((s) => [s.nature, s.etat, s.detail])).toEqual([
    ['recherche', 'terminee', null],
    ['enrichissement', 'erreur', 'Quota atteint'],
  ]);
  expect(await dernieresSessions(t.app.db, b.id)).toEqual([]);
});

it('compte les contacts acceptés, garde commentaire et contacts, et supprime les sessions terminées', async () => {
  const a = await createInstance(t.owner.db, { slug: 'sess-c', nom: 'C', type: 'propre' });
  const fiche = await insererFiche(t.owner.db, {
    instanceId: a.id,
    zone: 'a_enrichir',
    entreprise: 'Atelier Fictif',
    nom: '',
    provenance: 'Test',
  });
  const [tache] = await withInstance(t.app.db, a.id, (tx) =>
    tx
      .insert(enrichissementTaches)
      .values({
        instanceId: a.id,
        type: 'contacts',
        profil: [],
        maxParEntreprise: 2,
        etat: 'terminee',
      })
      .returning({ id: enrichissementTaches.id }),
  );
  await withInstance(t.app.db, a.id, (tx) =>
    tx.insert(enrichissementSuggestions).values([
      {
        instanceId: a.id,
        tacheId: tache!.id,
        ficheId: fiche,
        prenom: 'Léa',
        nom: 'Martin',
        fonction: 'Dirigeante',
        confiance: 'haute',
        etat: 'acceptee',
      },
      {
        instanceId: a.id,
        tacheId: tache!.id,
        ficheId: fiche,
        prenom: 'Paul',
        nom: 'Durand',
        confiance: 'basse',
        etat: 'refusee',
      },
    ]),
  );
  expect((await dernieresSessions(t.app.db, a.id))[0]).toMatchObject({ ajoutees: 1 });
  expect(await contactsDeSession(t.app.db, a.id, 'enrichissement', tache!.id)).toMatchObject([
    { entreprise: 'Atelier Fictif', prenom: 'Léa', statut: 'Ajouté' },
    { prenom: 'Paul', statut: 'Refusé' },
  ]);

  const id = await ouvrirSessionRecherche(t.app.db, a.id, { mode: 'manuel', nombreVise: 10 });
  expect(await supprimerSession(t.app.db, a.id, 'recherche', id)).toBe('en_cours');
  await cloreSessionRecherche(t.app.db, a.id, id, {
    etat: 'terminee',
    trouves: 1,
    contacts: [{ entreprise: 'Usine Fictive', prenom: 'Zoé', nom: 'Petit', fonction: 'DG' }],
  });
  await noterIntegrationSession(t.app.db, a.id, id, { ajoutees: 1, rapprochees: 0 });
  await commenterSession(t.app.db, a.id, 'recherche', id, ' Essai ');
  expect((await dernieresSessions(t.app.db, a.id)).find((s) => s.id === id)).toMatchObject({
    ajoutees: 1,
    commentaire: 'Essai',
  });
  expect(await contactsDeSession(t.app.db, a.id, 'recherche', id)).toEqual([
    { entreprise: 'Usine Fictive', prenom: 'Zoé', nom: 'Petit', fonction: 'DG', statut: null },
  ]);
  expect(await supprimerSession(t.app.db, a.id, 'recherche', id)).toBe('supprimee');
  expect(await supprimerSession(t.app.db, a.id, 'recherche', id)).toBe('absente');
  expect(await supprimerSession(t.app.db, a.id, 'enrichissement', tache!.id)).toBe('supprimee');
  expect(await dernieresSessions(t.app.db, a.id)).toEqual([]);
});
