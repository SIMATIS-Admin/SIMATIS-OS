import { afterAll, beforeAll, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import {
  lancerRecherche,
  lireRecherche,
  attendreRecherche,
  interrompreRecherches,
  effacerRecherche,
} from './recherche-tache.js';
import type { ReponseIA } from './client.js';

let t: TestApp;
beforeAll(async () => {
  t = await setupTestApp();
});
afterAll(async () => {
  await t.drop();
});

it('rend la main sans attendre, isole les instances, refuse un doublon et conserve les résultats', async () => {
  let finir!: (r: ReponseIA) => void;
  const client = {
    demander: () =>
      new Promise<ReponseIA>((r) => {
        finir = r;
      }),
  };
  const job = await lancerRecherche(t.app.db, client, 'fictif-a', 'Critères fictifs', 10);
  expect(job.etat).toBe('en_cours');
  expect(await lireRecherche(t.app.db, 'fictif-b')).toBeNull();
  await expect(lancerRecherche(t.app.db, client, 'fictif-a', 'Test', 10)).rejects.toThrow(
    'déjà en cours',
  );
  await effacerRecherche(t.app.db, 'fictif-a', job.id);
  expect((await lireRecherche(t.app.db, 'fictif-a'))?.etat).toBe('en_cours');
  finir({ json: { contacts: [] }, jetons: 0 });
  await attendreRecherche(job.id);
  expect((await lireRecherche(t.app.db, 'fictif-a'))?.contacts).toEqual([]);
  await effacerRecherche(t.app.db, 'fictif-a', 'autre');
  expect(await lireRecherche(t.app.db, 'fictif-a')).not.toBeNull();
  await effacerRecherche(t.app.db, 'fictif-a', job.id);
  expect(await lireRecherche(t.app.db, 'fictif-a')).toBeNull();
});

it('signale une interruption après redémarrage et protège la nouvelle recherche des anciennes réponses', async () => {
  let finir!: (r: ReponseIA) => void;
  const ancien = await lancerRecherche(
    t.app.db,
    {
      demander: () =>
        new Promise<ReponseIA>((r) => {
          finir = r;
        }),
    },
    'fictif-c',
    'Test',
    1,
  );
  await interrompreRecherches(t.app.db);
  expect((await lireRecherche(t.app.db, 'fictif-c'))?.etat).toBe('erreur');
  const nouveau = await lancerRecherche(
    t.app.db,
    { demander: () => Promise.resolve({ json: { contacts: [] }, jetons: 0 }) },
    'fictif-c',
    'Test',
    1,
  );
  await attendreRecherche(nouveau.id);
  finir({ json: { contacts: [] }, jetons: 0 });
  await attendreRecherche(ancien.id);
  expect((await lireRecherche(t.app.db, 'fictif-c'))?.id).toBe(nouveau.id);
});

it('répond 202 avant la fin du travail et retrouve son état par HTTP', async () => {
  const { default: Fastify } = await import('fastify');
  const { registerEnrichissementRoutes } = await import('./routes.js');
  const { createInstance } = await import('../instances/service.js');
  await createInstance(t.owner.db, {
    slug: 'recherche-fictive',
    nom: 'Recherche fictive',
    type: 'mandat',
  });
  let finir!: (r: ReponseIA) => void;
  const app = Fastify();
  registerEnrichissementRoutes(app, {
    db: t.app.db,
    enrichissement: null,
    codex: {
      demander: () =>
        new Promise<ReponseIA>((r) => {
          finir = r;
        }),
    },
  });
  const url = '/api/i/recherche-fictive/base/recherche/tache';
  const lancement = await app.inject({
    method: 'POST',
    url,
    payload: { consignes: 'Test fictif', nombre: 1 },
  });
  expect(lancement.statusCode).toBe(202);
  expect((await app.inject({ method: 'GET', url })).json().etat).toBe('en_cours');
  finir({ json: { contacts: [] }, jetons: 0 });
  await attendreRecherche(lancement.json().id);
  expect((await app.inject({ method: 'GET', url })).json().etat).toBe('terminee');
  await app.close();
});
