import { afterAll, beforeAll, expect, it, vi } from 'vitest';
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
// Le travail de fond écrit d'abord son état en base, puis appelle l'IA : tant que l'IA n'a pas été
// appelée, une écriture de fond peut encore arriver et écraser ce que le test vient de faire (ou
// `finir` n'existe pas encore). On attend donc que la recherche soit réellement en cours.
const attendreAppel = (appele: () => unknown) =>
  vi.waitFor(() => expect(appele()).toBeTypeOf('function'));
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
  await attendreAppel(() => finir);
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
  await attendreAppel(() => finir);
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
  expect((await app.inject({ method: 'GET', url })).json<{ etat: string }>().etat).toBe('en_cours');
  await attendreAppel(() => finir);
  finir({ json: { contacts: [] }, jetons: 0 });
  await attendreRecherche(lancement.json<{ id: string }>().id);
  expect((await app.inject({ method: 'GET', url })).json<{ etat: string }>().etat).toBe(
    'a_completer',
  );
  await app.close();
});

it('complète par passages jusqu’à dix contacts vérifiés et évite les doublons', async () => {
  let appel = 0;
  const client = {
    demander: () => {
      appel++;
      const contacts = Array.from({ length: appel === 4 ? 1 : 3 }, (_, i) => ({
        entreprise: `Atelier fictif ${appel}-${i}`,
        prenom: 'Alice',
        nom: `Exemple ${appel}-${i}`,
        fonction: 'Direction',
        email: `alice${appel}${i}@atelier.example`,
        linkedin: null,
        source: 'https://atelier.example/equipe',
        qualification: 'Données fictives',
      }));
      return Promise.resolve({ json: { contacts }, jetons: 0 });
    },
  };
  const job = await lancerRecherche(t.app.db, client, 'fictif-dix', 'Test fictif', 10);
  await attendreRecherche(job.id);
  const resultat = await lireRecherche(t.app.db, 'fictif-dix');
  expect(resultat?.etat).toBe('terminee');
  expect(resultat?.contacts).toHaveLength(10);
  expect(resultat?.passage).toBe(4);
});

it('conserve les contacts et propose de poursuivre quand un passage ne rapporte que des doublons', async () => {
  const contact = {
    entreprise: 'Atelier fictif',
    prenom: 'Alice',
    nom: 'Exemple',
    fonction: 'Direction',
    email: 'alice@atelier.example',
    linkedin: null,
    source: 'https://atelier.example/equipe',
    qualification: 'Données fictives',
  };
  const client = { demander: () => Promise.resolve({ json: { contacts: [contact] }, jetons: 0 }) };
  const job = await lancerRecherche(t.app.db, client, 'fictif-doublon', 'Test fictif', 10);
  await attendreRecherche(job.id);
  const resultat = await lireRecherche(t.app.db, 'fictif-doublon');
  expect(resultat?.etat).toBe('a_completer');
  expect(resultat?.contacts).toHaveLength(1);
  expect(resultat?.consignes).toBe('Test fictif');
  const suite = await lancerRecherche(
    t.app.db,
    client,
    'fictif-doublon',
    resultat!.consignes!,
    10,
    resultat!.contacts,
  );
  await attendreRecherche(suite.id);
  expect((await lireRecherche(t.app.db, 'fictif-doublon'))?.contacts).toHaveLength(1);
});

it('classe les anciennes recherches terminées sous dix contacts comme à compléter', async () => {
  const { preferences } = await import('../preferences/schema.js');
  await t.owner.db.insert(preferences).values({
    utilisateur: 'recherche-manuelle:fictif-ancien',
    favoris: [],
    options: {
      rechercheManuelle: {
        id: 'fictif',
        etat: 'terminee',
        nombre: 10,
        debut: '2026-01-01T09:00:00Z',
        contacts: [],
      },
    },
  });
  expect((await lireRecherche(t.app.db, 'fictif-ancien'))?.etat).toBe('a_completer');
});
