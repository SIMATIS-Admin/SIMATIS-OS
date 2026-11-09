import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { buildApp } from '../app.js';
import { createInstance } from '../instances/service.js';

type Reglage = { mandat: string; delaiPaiementJours: number | null };

// Données fictives.
describe('Routes Gestion — délai de paiement par mandat', () => {
  let t: TestApp;
  let app: ReturnType<typeof buildApp>;
  const base = '/api/i/mdt-propre/gestion/mandats';

  beforeAll(async () => {
    t = await setupTestApp();
    app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test' });
    await createInstance(t.owner.db, {
      slug: 'mdt-propre',
      nom: 'Mon activité',
      type: 'propre',
      config: { modules: ['gestion'] },
    });
    await createInstance(t.owner.db, { slug: 'mdt-a', nom: 'Mandat A', type: 'mandat' });
  });
  afterAll(async () => {
    await app.close();
    await t.drop();
  });

  const lire = async () =>
    (await app.inject({ method: 'GET', url: `${base}/reglages` })).json<Reglage[]>();
  const poser = (mandat: string, payload: object) =>
    app.inject({ method: 'PUT', url: `${base}/${mandat}/reglages`, payload });

  it('ne liste rien au départ', async () => {
    expect(await lire()).toEqual([]);
  });

  it('pose un délai puis le relit', async () => {
    expect((await poser('mdt-a', { delaiPaiementJours: 45 })).statusCode).toBe(200);
    expect(await lire()).toEqual([{ mandat: 'mdt-a', delaiPaiementJours: 45 }]);
  });

  it('met à jour sans doublon', async () => {
    await poser('mdt-a', { delaiPaiementJours: 30 });
    expect(await lire()).toEqual([{ mandat: 'mdt-a', delaiPaiementJours: 30 }]);
  });

  it('efface le délai avec null : le mandat reste listé', async () => {
    await poser('mdt-a', { delaiPaiementJours: null });
    expect(await lire()).toEqual([{ mandat: 'mdt-a', delaiPaiementJours: null }]);
  });

  it('refuse un délai hors bornes ou un identifiant invalide', async () => {
    expect((await poser('mdt-a', { delaiPaiementJours: 400 })).statusCode).toBe(400);
    expect((await poser('mdt-a', { delaiPaiementJours: -1 })).statusCode).toBe(400);
    expect((await poser('Pas%20Un%20Slug', { delaiPaiementJours: 10 })).statusCode).toBe(400);
  });

  it('expose les factures à émettre (rien à facturer au départ)', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/i/mdt-propre/gestion/factures' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ factures: [], sansMandat: [] });
  });

  it('refuse hors de « Mon activité »', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/i/mdt-a/gestion/mandats/reglages' });
    expect(r.statusCode).toBe(403);
  });
});
