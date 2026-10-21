import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { buildApp } from '../app.js';
import { createInstance } from '../instances/service.js';

describe('Routes de liens entre fiches', () => {
  let t: TestApp;
  let app: ReturnType<typeof buildApp>;
  let secretsDir: string;
  const base = '/api/i/liens-routes';

  beforeAll(async () => {
    t = await setupTestApp();
    await createInstance(t.owner.db, { slug: 'liens-routes', nom: 'Routes', type: 'mandat' });
    secretsDir = await mkdtemp(path.join(tmpdir(), 'simatis-liens-routes-'));
    app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test', secretsDir });
  });

  afterAll(async () => {
    await app.close();
    await t.drop();
    await rm(secretsDir, { recursive: true, force: true });
  });

  const creer = async (url: string, payload: Record<string, unknown>) => {
    const r = await app.inject({ method: 'POST', url: `${base}/${url}`, payload });
    expect(r.statusCode, r.body).toBe(201);
    return r.json<{ id: string }>();
  };
  const fiche = async (kind: string, id: string) =>
    (await app.inject({ method: 'GET', url: `${base}/fiches/${kind}/${id}` })).json<{
      liens: Record<string, { nom?: string; titre?: string; principal: boolean }[]>;
    }>();

  it('crée une personne et une affaire déjà liées à une organisation, puis les délie', async () => {
    const orga = await creer('entreprises', { nom: 'Organisation de route' });
    const lien = { lierA: { kind: 'entreprise', id: orga.id } };
    const personne = await creer('contacts', { nom: 'Personne de route', ...lien });
    const affaire = await creer('opportunites', {
      titre: 'Affaire de route',
      etape: 'detection',
      lierA: { kind: 'entreprise', id: orga.id },
    });

    const vue = await fiche('entreprise', orga.id);
    expect(vue.liens.contacts?.map((c) => c.nom)).toEqual(['Personne de route']);
    expect(vue.liens.affaires?.map((o) => o.titre)).toEqual(['Affaire de route']);

    const ajout = await app.inject({
      method: 'POST',
      url: `${base}/fiches/affaire/${affaire.id}/liens`,
      payload: { avec: { kind: 'contact', id: personne.id } },
    });
    expect(ajout.json()).toEqual({ ok: true });
    expect((await fiche('affaire', affaire.id)).liens.contacts?.[0]).toMatchObject({
      nom: 'Personne de route',
      principal: true,
    });

    const retrait = await app.inject({
      method: 'DELETE',
      url: `${base}/fiches/affaire/${affaire.id}/liens`,
      payload: { avec: { kind: 'contact', id: personne.id } },
    });
    expect(retrait.json()).toEqual({ ok: true });
    expect((await fiche('affaire', affaire.id)).liens.contacts).toEqual([]);
  });

  it('change le principal', async () => {
    const affaire = await creer('opportunites', {
      titre: 'Affaire principale',
      etape: 'detection',
    });
    const [o1, o2] = [
      await creer('entreprises', { nom: 'Organisation A' }),
      await creer('entreprises', { nom: 'Organisation B' }),
    ];
    for (const o of [o1, o2])
      await app.inject({
        method: 'POST',
        url: `${base}/fiches/affaire/${affaire.id}/liens`,
        payload: { avec: { kind: 'entreprise', id: o.id } },
      });
    const r = await app.inject({
      method: 'PUT',
      url: `${base}/fiches/affaire/${affaire.id}/liens/principal`,
      payload: { avec: { kind: 'entreprise', id: o2.id } },
    });
    expect(r.json()).toEqual({ ok: true });
    expect(
      (await fiche('affaire', affaire.id)).liens.entreprises?.map((e) => [e.nom, e.principal]),
    ).toEqual([
      ['Organisation B', true],
      ['Organisation A', false],
    ]);
  });

  it('refuse les demandes invalides', async () => {
    const orga = await creer('entreprises', { nom: 'Organisation refus' });
    const post = (url: string, payload: unknown) =>
      app.inject({ method: 'POST', url: `${base}/${url}`, payload: payload as never });
    expect((await post('fiches/robot/' + orga.id + '/liens', {})).statusCode).toBe(404);
    expect((await post(`fiches/entreprise/${orga.id}/liens`, { avec: 'x' })).statusCode).toBe(400);
    expect(
      (
        await post(`fiches/entreprise/${orga.id}/liens`, {
          avec: { kind: 'entreprise', id: orga.id },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await post('contacts', { nom: 'X', lierA: { kind: 'contact', id: orga.id } })).statusCode,
    ).toBe(400);
    expect(
      (
        await post(`fiches/entreprise/${orga.id}/liens`, {
          avec: { kind: 'contact', id: '00000000-0000-4000-8000-000000000000' },
        })
      ).statusCode,
    ).toBe(400);
  });
});
