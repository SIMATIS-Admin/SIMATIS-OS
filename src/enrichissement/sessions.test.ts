import { afterAll, beforeAll, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { createInstance } from '../instances/service.js';
import { withInstance } from '../db/context.js';
import { enrichissementTaches } from './schema.js';
import { cloreSessionRecherche, dernieresSessions, ouvrirSessionRecherche } from './sessions.js';

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
