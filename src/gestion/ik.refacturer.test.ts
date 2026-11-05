import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { buildApp } from '../app.js';
import { createInstance } from '../instances/service.js';
import type { EtatIkMois } from './ik.js';

// Données fictives : aucun taux, lieu ni distance réels.
describe('IK — trajets refacturables à un mandat', () => {
  let t: TestApp;
  let app: ReturnType<typeof buildApp>;
  const base = '/api/i/ik-refac/gestion';
  let vehiculeId = '';

  beforeAll(async () => {
    t = await setupTestApp();
    app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test' });
    await createInstance(t.owner.db, {
      slug: 'ik-refac',
      nom: 'Mon activité',
      type: 'propre',
      config: { modules: ['gestion'] },
    });
    await createInstance(t.owner.db, { slug: 'mandat-a', nom: 'Mandat A', type: 'mandat' });
    const v = await envoyer('POST', '/ik/vehicules', { libelle: 'Voiture', categorie: 'auto' });
    vehiculeId = v.json<{ id: string }>().id;
  });
  afterAll(async () => {
    await app.close();
    await t.drop();
  });

  const envoyer = (method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url: `${base}${url}`, payload });
  const trajet = (date: string, nom: string, extra: object = {}) =>
    envoyer('POST', '/ik/trajets', {
      vehiculeId,
      date,
      trajet: nom,
      commentaire: 'Réunion fictive',
      kmAllerRetour: 40,
      ...extra,
    });
  const etat = async (mois: string) =>
    (
      await app.inject({
        method: 'GET',
        url: `${base}/ik/etat?mois=${mois}&vehiculeId=${vehiculeId}`,
      })
    ).json<EtatIkMois>();

  it('refuse un trajet refacturer sans mandat', async () => {
    const r = await trajet('2026-05-04', 'Sans mandat', { refacturer: true });
    expect(r.statusCode).toBe(400);
  });

  it('crée un trajet refacturable et l’expose dans l’état du mois', async () => {
    const r = await trajet('2026-05-05', 'Vers le mandat', {
      mandat: 'mandat-a',
      refacturer: true,
    });
    expect(r.statusCode).toBe(200);
    const e = await etat('2026-05');
    expect(e.lignes).toHaveLength(1);
    expect(e.lignes[0]).toMatchObject({ mandat: 'mandat-a', refacturer: true });
  });

  it('un trajet sans la case reste non refacturable par défaut', async () => {
    await trajet('2026-05-06', 'Simple', { mandat: 'mandat-a' });
    const e = await etat('2026-05');
    expect(e.lignes.find((l) => l.trajet === 'Simple')?.refacturer).toBe(false);
  });

  it('refuse de retirer le mandat d’un trajet refacturable', async () => {
    const id = (await etat('2026-05')).lignes.find((l) => l.trajet === 'Vers le mandat')!.id;
    const r = await envoyer('PATCH', `/ik/trajets/${id}`, { mandat: null });
    expect(r.statusCode).toBe(400);
  });

  it('refuse de cocher refacturer sur un trajet sans mandat', async () => {
    await trajet('2026-05-07', 'Libre');
    const id = (await etat('2026-05')).lignes.find((l) => l.trajet === 'Libre')!.id;
    expect((await envoyer('PATCH', `/ik/trajets/${id}`, { refacturer: true })).statusCode).toBe(
      400,
    );
  });

  it('décoche refacturer sur un trajet validé pour transmission, sans rouvrir le mois', async () => {
    await trajet('2026-06-02', 'Mois figé', { mandat: 'mandat-a', refacturer: true });
    await envoyer('POST', '/ik/mois/2026-06/avancer', { vehiculeId, action: 'a_controler' });
    await envoyer('PUT', '/ik/mois/2026-06/abonnement', { abonnement: false });
    const valide = await envoyer('POST', '/ik/mois/2026-06/avancer', {
      vehiculeId,
      action: 'valide',
    });
    expect(valide.statusCode).toBe(200);
    const id = (await etat('2026-06')).lignes[0]!.id;
    expect((await envoyer('PATCH', `/ik/trajets/${id}`, { refacturer: false })).statusCode).toBe(
      200,
    );
    expect((await etat('2026-06')).lignes[0]!.refacturer).toBe(false);
    // Les kilomètres, eux, restent figés.
    expect((await envoyer('PATCH', `/ik/trajets/${id}`, { kmAllerRetour: 5 })).statusCode).toBe(
      400,
    );
  });
});
