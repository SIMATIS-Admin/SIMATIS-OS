import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { buildApp } from '../app.js';
import { createInstance } from '../instances/service.js';
import type { CampagneVue, ModeleVue } from './modeles.js';

type Vue = {
  etapes: string[];
  limiteInvitation: number;
  modeles: ModeleVue[];
  campagnes: CampagneVue[];
};

// Textes fictifs : les vrais messages se saisissent dans l'OS, jamais dans le dépôt.
describe('Routes des messages Sales Navigator', () => {
  let t: TestApp;
  let app: ReturnType<typeof buildApp>;
  const base = '/api/i/sn-routes/salesnav';

  beforeAll(async () => {
    t = await setupTestApp();
    await createInstance(t.owner.db, { slug: 'sn-routes', nom: 'Routes', type: 'mandat' });
    await createInstance(t.owner.db, { slug: 'sn-autre', nom: 'Autre', type: 'mandat' });
    app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test' });
  });

  afterAll(async () => {
    await app.close();
    await t.drop();
  });

  const vue = async (url = `${base}/modeles`) =>
    (await app.inject({ method: 'GET', url })).json<Vue>();
  const put = (url: string, texte: string) =>
    app.inject({ method: 'PUT', url, payload: { texte } });

  it("renvoie les étapes et la limite pour un espace sans rien d'enregistré", async () => {
    const v = await vue();
    expect(v.etapes).toEqual(['invitation', 'acceptation', 'relance1', 'relance2']);
    expect(v.limiteInvitation).toBe(300);
    expect(v.modeles).toEqual([]);
    expect(v.campagnes).toEqual([]);
  });

  it('enregistre un modèle par défaut puis une campagne qui le remplace pour une étape', async () => {
    expect((await put(`${base}/modeles/cible-1/relance1`, 'Relance de base')).statusCode).toBe(200);
    const c = await app.inject({
      method: 'POST',
      url: `${base}/campagnes`,
      payload: { nom: 'Lot de test', icp: 'cible-1' },
    });
    expect(c.statusCode).toBe(201);
    const { id } = c.json<{ id: string }>();
    expect(
      (await put(`${base}/campagnes/${id}/modeles/relance1`, 'Relance du lot')).statusCode,
    ).toBe(200);
    const v = await vue();
    expect(v.modeles).toEqual([{ icp: 'cible-1', etape: 'relance1', texte: 'Relance de base' }]);
    expect(v.campagnes[0]?.surcharges).toEqual([{ etape: 'relance1', texte: 'Relance du lot' }]);
  });

  it('prépare le message avec les variables et dit si elles manquent', async () => {
    const { id } = (await vue()).campagnes[0]!;
    const url = `${base}/campagnes/${id}/messages/relance1`;
    const ok = await app.inject({ method: 'POST', url, payload: { prenom: 'Julie' } });
    expect(ok.json()).toMatchObject({ origine: 'campagne', texte: 'Relance du lot' });
    await put(`${base}/campagnes/${id}/modeles/relance1`, 'Bonjour {prénom}, chez {entreprise} ?');
    const partiel = await app.inject({ method: 'POST', url, payload: { prenom: 'Julie' } });
    expect(partiel.json()).toMatchObject({
      texte: 'Bonjour Julie, chez {entreprise} ?',
      manquantes: ['entreprise'],
    });
  });

  it('remet une étape au modèle par défaut', async () => {
    const { id } = (await vue()).campagnes[0]!;
    const r = await app.inject({
      method: 'DELETE',
      url: `${base}/campagnes/${id}/modeles/relance1`,
    });
    expect(r.statusCode).toBe(200);
    const m = await app.inject({
      method: 'POST',
      url: `${base}/campagnes/${id}/messages/relance1`,
      payload: {},
    });
    expect(m.json()).toMatchObject({ origine: 'defaut', texte: 'Relance de base' });
  });

  it("refuse une note d'invitation trop longue, un texte vide et une étape inconnue (400)", async () => {
    expect((await put(`${base}/modeles/cible-1/invitation`, 'x'.repeat(301))).statusCode).toBe(400);
    expect((await put(`${base}/modeles/cible-1/relance2`, '  ')).statusCode).toBe(400);
    expect((await put(`${base}/modeles/cible-1/autre`, 'Texte')).statusCode).toBe(400);
  });

  it('404 sur une campagne ou une instance inconnue, et chaque espace reste séparé', async () => {
    const inconnue = '00000000-0000-4000-8000-000000000000';
    expect(
      (await app.inject({ method: 'DELETE', url: `${base}/campagnes/${inconnue}` })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: '/api/i/inconnue/salesnav/modeles' })).statusCode,
    ).toBe(404);
    const autre = await vue('/api/i/sn-autre/salesnav/modeles');
    expect(autre.modeles).toEqual([]);
    expect(autre.campagnes).toEqual([]);
  });

  it('supprime une campagne et ses textes propres', async () => {
    const { id } = (await vue()).campagnes[0]!;
    expect(
      (await app.inject({ method: 'DELETE', url: `${base}/campagnes/${id}` })).statusCode,
    ).toBe(200);
    expect((await vue()).campagnes).toEqual([]);
    expect((await vue()).modeles).toHaveLength(1);
  });
});
