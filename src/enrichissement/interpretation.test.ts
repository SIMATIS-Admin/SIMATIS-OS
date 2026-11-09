import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { createInstance } from '../instances/service.js';
import { ErreurIA, type ClientIA } from './client.js';
import { registerEnrichissementRoutes } from './routes.js';

const reponse = {
  resume: 'PME de la métallurgie dans le Rhône',
  q: '',
  secteurs: [{ code: '25', libelle: 'Produits métalliques' }],
  departements: ['69'],
  effectifs: ['12'],
  categories: ['PME'],
  caMin: null,
  caMax: null,
  nonTraites: ['sans directeur commercial'],
};
const ia = (json: unknown): ClientIA => ({ demander: () => Promise.resolve({ json, jetons: 5 }) });
const enPanne: ClientIA = {
  demander: () => Promise.reject(new ErreurIA('Quota API OpenAI épuisé.', true)),
};

describe('interprétation d’une recherche d’entreprises', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await setupTestApp();
    await createInstance(t.owner.db, { slug: 'int-a', nom: 'A', type: 'propre' });
  });
  afterAll(async () => {
    await t.drop();
  });

  const appel = (
    client: ClientIA | undefined,
    payload: unknown,
    delaiInterpretationMs?: number,
  ) => {
    const a = Fastify();
    registerEnrichissementRoutes(a, {
      db: t.app.db,
      enrichissement: null,
      client,
      delaiInterpretationMs,
    });
    return a.inject({
      method: 'POST',
      url: '/api/i/int-a/base/entreprises/interpreter',
      payload: payload as object,
    });
  };

  it('rend les critères et ce que l’annuaire ne sait pas filtrer', async () => {
    const res = await appel(ia(reponse), {
      demande: 'PME de la métallurgie du Rhône sans directeur commercial',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      criteres: { departements: ['69'], effectifs: ['12'], categories: ['PME'] },
      nonTraites: ['sans directeur commercial'],
    });
  });

  it('prévient quand aucune IA n’est disponible, et refuse une demande vide', async () => {
    const sansIa = await appel(undefined, { demande: 'PME' });
    expect(sansIa.statusCode).toBe(409);
    expect((await appel(ia(reponse), { demande: '   ' })).statusCode).toBe(400);
  });

  it('transmet l’erreur de l’IA sans planter', async () => {
    const res = await appel(enPanne, { demande: 'PME du Rhône' });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toContain('Quota');
    expect((await appel(ia({ resume: 3 }), { demande: 'PME' })).statusCode).toBe(400);
  });

  it('rend la main quand l’IA ne répond pas dans le délai', async () => {
    const muette: ClientIA = { demander: () => new Promise(() => undefined) };
    const res = await appel(muette, { demande: 'PME du Rhône' }, 20);
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toContain('ne répond pas');
  });
});
