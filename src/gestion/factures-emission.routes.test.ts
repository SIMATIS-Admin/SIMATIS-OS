import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { buildApp } from '../app.js';
import { createInstance } from '../instances/service.js';
import type { FactureEmise } from './factures-emission.js';

// Données fictives.
describe('Routes Gestion — émission et encaissement des factures', () => {
  let t: TestApp;
  let app: ReturnType<typeof buildApp>;
  const base = '/api/i/emr-propre/gestion';

  beforeAll(async () => {
    t = await setupTestApp();
    app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test' });
    await createInstance(t.owner.db, {
      slug: 'emr-propre',
      nom: 'Mon activité',
      type: 'propre',
      config: { modules: ['gestion'] },
    });
    await createInstance(t.owner.db, { slug: 'emr-mandat', nom: 'Mandat', type: 'mandat' });
    await app.inject({
      method: 'POST',
      url: `${base}/revenus`,
      payload: {
        libelle: 'Commission fictive',
        montantHtCents: 50_000,
        date: '2026-11-05',
        mandat: 'emr-a',
      },
    });
  });
  afterAll(async () => {
    await app.close();
    await t.drop();
  });

  const post = (url: string, payload: object, slug = 'emr-propre') =>
    app.inject({ method: 'POST', url: `/api/i/${slug}/gestion${url}`, payload });
  const emission = { mandat: 'emr-a', numero: 'F-R1', dateEmission: '2026-11-12' };

  it('refuse hors de « Mon activité »', async () => {
    expect((await post('/factures/emettre', emission, 'emr-mandat')).statusCode).toBe(403);
  });

  it('refuse une requête invalide', async () => {
    expect((await post('/factures/emettre', { ...emission, numero: '' })).statusCode).toBe(400);
    expect((await post('/factures/emettre', { mandat: 'Pas Un Slug' })).statusCode).toBe(400);
  });

  it('émet (201), liste, refuse un doublon, encaisse', async () => {
    const r = await post('/factures/emettre', emission);
    expect(r.statusCode).toBe(201);
    const f = r.json<FactureEmise>();
    expect(f).toMatchObject({ numero: 'F-R1', totalHtCents: 50_000, etat: 'emise' });

    const liste = await app.inject({ method: 'GET', url: `${base}/factures/emises` });
    expect(liste.json<FactureEmise[]>().map((x) => x.numero)).toEqual(['F-R1']);

    expect((await post('/factures/emettre', emission)).statusCode).toBe(400);

    const e = await post(`/factures/${f.id}/encaisser`, { dateEncaissement: '2026-12-20' });
    expect(e.statusCode).toBe(200);
    expect(e.json<FactureEmise>()).toMatchObject({ etat: 'encaissee' });
    expect(
      (await post(`/factures/${f.id}/encaisser`, { dateEncaissement: '2026-12-21' })).statusCode,
    ).toBe(400);
    expect(
      (
        await post('/factures/00000000-0000-4000-8000-000000000000/encaisser', {
          dateEncaissement: '2026-12-21',
        })
      ).statusCode,
    ).toBe(404);
  });
});
