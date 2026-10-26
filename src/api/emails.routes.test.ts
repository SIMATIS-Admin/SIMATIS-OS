import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { buildApp } from '../app.js';
import { createInstance } from '../instances/service.js';

describe('Routes des adresses email d’un contact', () => {
  let t: TestApp;
  let app: ReturnType<typeof buildApp>;
  let secretsDir: string;
  const base = '/api/i/emails-routes';

  beforeAll(async () => {
    t = await setupTestApp();
    await createInstance(t.owner.db, { slug: 'emails-routes', nom: 'Routes', type: 'mandat' });
    secretsDir = await mkdtemp(path.join(tmpdir(), 'simatis-emails-routes-'));
    app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test', secretsDir });
  });

  afterAll(async () => {
    await app.close();
    await t.drop();
    await rm(secretsDir, { recursive: true, force: true });
  });

  const appel = (method: 'POST' | 'DELETE' | 'PUT', id: string, email: string, suite = '') =>
    app.inject({
      method,
      url: `${base}/fiches/contact/${id}/emails${suite}`,
      payload: { email },
    });

  it('ajoute, promeut et retire des adresses, visibles dans la fiche', async () => {
    const { id } = (
      await app.inject({
        method: 'POST',
        url: `${base}/contacts`,
        payload: { nom: 'Contact de route', email: 'un@exemple.test' },
      })
    ).json<{ id: string }>();

    const ajout = await appel('POST', id, 'deux@exemple.test');
    expect(ajout.json()).toEqual({
      emails: [
        { email: 'un@exemple.test', principal: true },
        { email: 'deux@exemple.test', principal: false },
      ],
    });
    expect((await appel('POST', id, 'deux@exemple.test')).statusCode).toBe(400);
    expect((await appel('POST', id, 'pas-un-email')).statusCode).toBe(400);

    const promu = await appel('PUT', id, 'deux@exemple.test', '/principal');
    expect(promu.json<{ emails: unknown[] }>().emails[0]).toEqual({
      email: 'deux@exemple.test',
      principal: true,
    });

    const fiche = (await app.inject({ method: 'GET', url: `${base}/fiches/contact/${id}` })).json<{
      fiche: { email: string; emails: { email: string }[] };
    }>();
    expect(fiche.fiche.email).toBe('deux@exemple.test');
    expect(fiche.fiche.emails.map((e) => e.email)).toEqual([
      'deux@exemple.test',
      'un@exemple.test',
    ]);

    const retire = await appel('DELETE', id, 'deux@exemple.test');
    expect(retire.json()).toEqual({ emails: [{ email: 'un@exemple.test', principal: true }] });
  });

  it('corriger le champ email remplace la principale sans laisser l’ancienne', async () => {
    const { id } = (
      await app.inject({
        method: 'POST',
        url: `${base}/contacts`,
        payload: { nom: 'Faute de frappe', email: 'fote@exemple.test' },
      })
    ).json<{ id: string }>();
    const patch = await app.inject({
      method: 'PATCH',
      url: `${base}/fiches/contact/${id}`,
      payload: { email: 'faute@exemple.test' },
    });
    expect(patch.json<{ fiche: { emails: unknown } }>().fiche.emails).toEqual([
      { email: 'faute@exemple.test', principal: true },
    ]);
  });

  it('refuse une fiche qui n’est pas un contact ou un contact inconnu', async () => {
    const inconnu = '00000000-0000-4000-8000-000000000000';
    expect((await appel('POST', inconnu, 'x@exemple.test')).statusCode).toBe(404);
    const r = await app.inject({
      method: 'POST',
      url: `${base}/fiches/entreprise/${inconnu}/emails`,
      payload: { email: 'x@exemple.test' },
    });
    expect(r.statusCode).toBe(404);
  });
});
