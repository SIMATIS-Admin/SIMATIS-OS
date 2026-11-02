import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { buildApp } from '../app.js';
import { createInstance } from '../instances/service.js';

type Liste = {
  synthese: { aEncaisserCents: number; encaisseCents: number };
  revenus: { id: string; libelle: string; mandat: string | null; etat: string }[];
};

describe('Routes Gestion — recettes ponctuelles', () => {
  let t: TestApp;
  let app: ReturnType<typeof buildApp>;
  const base = '/api/i/rev-propre/gestion/revenus';

  beforeAll(async () => {
    t = await setupTestApp();
    app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test' });
    for (const slug of ['rev-propre', 'rev-autre'])
      await createInstance(t.owner.db, {
        slug,
        nom: slug,
        type: 'propre',
        config: { modules: ['gestion'] },
      });
    await createInstance(t.owner.db, { slug: 'rev-mandat', nom: 'Mandat', type: 'mandat' });
  });
  afterAll(async () => {
    await app.close();
    await t.drop();
  });

  const lister = async (mois: string, slug = 'rev-propre') =>
    (
      await app.inject({ method: 'GET', url: `/api/i/${slug}/gestion/revenus?mois=${mois}` })
    ).json<Liste>();
  const creer = (corps: object, slug = 'rev-propre') =>
    app.inject({ method: 'POST', url: `/api/i/${slug}/gestion/revenus`, payload: corps });
  const commission = {
    libelle: 'Commission fictive',
    montantHtCents: 600_000,
    date: '2026-11-20',
    mandat: 'mandat-alpha',
  };

  it('refuse hors de « Mon activité » avec le module', async () => {
    expect((await creer(commission, 'rev-mandat')).statusCode).toBe(403);
  });

  it('crée une recette unique pour un mandat, prévue par défaut, sans toucher aux dépenses', async () => {
    const r = await creer(commission);
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ type: 'commission', etat: 'prevue', mandat: 'mandat-alpha' });
    const l = await lister('2026-11');
    expect(l.revenus).toHaveLength(1);
    expect(l.synthese).toEqual({ mois: '2026-11', aEncaisserCents: 600_000, encaisseCents: 0 });
    const dep = await app.inject({
      method: 'GET',
      url: '/api/i/rev-propre/gestion/depenses?mois=2026-11',
    });
    expect(dep.json<{ synthese: { totalCents: number } }>().synthese.totalCents).toBe(0);
  });

  it('accepte une recette sans mandat et valide la saisie', async () => {
    expect((await creer({ ...commission, mandat: null, libelle: 'Libre' })).statusCode).toBe(201);
    expect((await creer({ ...commission, montantHtCents: 10.5 })).statusCode).toBe(400);
    expect((await creer({ ...commission, mandat: 'Pas un slug' })).statusCode).toBe(400);
    expect((await creer({ ...commission, etat: 'encaissee' })).statusCode).toBe(400);
  });

  it('distingue facturée et encaissée, l’encaissement compte à sa propre date', async () => {
    const id = (await creer({ ...commission, libelle: 'Suivie', date: '2026-12-05' })).json<{
      id: string;
    }>().id;
    const emise = await app.inject({
      method: 'PATCH',
      url: `${base}/${id}`,
      payload: { etat: 'emise', referenceFacture: 'F-FICTIVE-1' },
    });
    expect(emise.json()).toMatchObject({ etat: 'emise', referenceFacture: 'F-FICTIVE-1' });
    const sans = await app.inject({
      method: 'PATCH',
      url: `${base}/${id}`,
      payload: { etat: 'encaissee' },
    });
    expect(sans.statusCode).toBe(400);
    await app.inject({
      method: 'PATCH',
      url: `${base}/${id}`,
      payload: { etat: 'encaissee', dateEncaissement: '2027-01-12' },
    });
    expect((await lister('2026-12')).revenus).toHaveLength(0);
    expect((await lister('2027-01')).synthese).toMatchObject({
      encaisseCents: 600_000,
      aEncaisserCents: 0,
    });
  });

  it('archive sans supprimer et cloisonne les instances', async () => {
    const id = (await creer({ ...commission, libelle: 'À retirer', date: '2019-03-03' })).json<{
      id: string;
    }>().id;
    expect((await lister('2019-03')).revenus).toHaveLength(1);
    expect((await app.inject({ method: 'DELETE', url: `${base}/${id}` })).statusCode).toBe(200);
    expect((await lister('2019-03')).revenus).toHaveLength(0);
    expect((await lister('2026-11', 'rev-autre')).revenus).toHaveLength(0);
  });
});
