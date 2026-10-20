import { randomBytes } from 'node:crypto';
import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { createInstance } from '../instances/service.js';
import type { Instance } from '../instances/schema.js';
import { creerInvitation } from './invitations.js';
import { releverTestsVma } from './releve.js';
import { registerVmaRoutes } from './routes.js';

const JETON = 'jeton-de-test-vma-'.padEnd(40, 'q');
const SITE = 'https://site.test';
const hex = () => randomBytes(16).toString('hex');

// Faux site : répond aux invitations, puis sert un résultat à la relève.
function faux(resultats: unknown[] = []) {
  const invitations = new Map<string, { entreprise: string; type: string }>();
  let file = resultats;
  const acquittes: string[][] = [];
  const fetch = ((url: string | URL, init?: RequestInit) =>
    Promise.resolve(repondre(String(url), init))) as typeof globalThis.fetch;
  function repondre(u: string, init?: RequestInit): Response {
    if (new Headers(init?.headers).get('authorization') !== `Bearer ${JETON}`) {
      return new Response('{}', { status: 401 });
    }
    const methode = init?.method ?? 'GET';
    if (u.endsWith('/api/test-vma/invitations') && methode === 'POST') {
      const corps = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
        entreprise: string;
        type: string;
      };
      const id = hex();
      invitations.set(id, corps);
      return Response.json(
        { id, expireLe: new Date(Date.now() + 86_400_000).toISOString() },
        { status: 201 },
      );
    }
    if (u.includes('/api/test-vma/invitations?id=') && methode === 'DELETE') {
      const id = new URL(u).searchParams.get('id') ?? '';
      if (!invitations.has(id)) return new Response('{}', { status: 404 });
      invitations.delete(id);
      return Response.json({ id, statut: 'revoquee' });
    }
    if (u.endsWith('/api/test-vma/en-attente')) return Response.json({ resultats: file });
    if (u.endsWith('/api/test-vma/acquitter')) {
      const ids = (
        JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { ids: string[] }
      ).ids;
      acquittes.push(ids);
      file = file.filter((r) => !ids.includes((r as { id: string }).id));
      return Response.json({ effaces: ids.length });
    }
    return new Response('{}', { status: 404 });
  }
  return { fetch, acquittes, deposer: (r: unknown[]) => (file = r) };
}

const ecranDeTest = (entreprise: string) => ({
  entreprise,
  vma: 15000,
  mesurable: true,
  statut: 'prouvée',
  tenue: 'tenue',
  allureVisee: 20000,
  echeance: 2,
  niveau: { cle: 'real', label: 'Réaliste', phrase: 'Phrase fictive.' },
  ecart: 5000,
  ecartPct: 0.33,
  freins: [],
  textes: { definitionVma: 'D.', nonMesurable: 'N.', aucunFrein: 'A.' },
});

describe('brouillon du résultat à la relève', () => {
  let t: TestApp;
  let mandat: Instance;

  beforeAll(async () => {
    t = await setupTestApp();
    await createInstance(t.owner.db, {
      slug: 'brouillon-propre',
      nom: 'Mon activité',
      type: 'propre',
    });
    mandat = await createInstance(t.owner.db, {
      slug: 'brouillon-mandat',
      nom: 'Mandat',
      type: 'mandat',
    });
  });

  afterAll(async () => {
    await t.drop();
  });

  beforeEach(async () => {
    await t.owner.pool.query("delete from sujets where origine = 'test-vma'");
    await t.owner.pool.query('delete from vma_tests');
  });

  it("sans messagerie configurée, le sujet reste créé et dit pourquoi il n'y a pas de brouillon", async () => {
    const site = faux();
    const test = await creerInvitation(
      t.app.db,
      { url: SITE, token: JETON, fetch: site.fetch },
      {
        instanceId: mandat.id,
        entrepriseNom: 'Atelier Fictif',
        type: 'premier',
        contactNom: 'Jeanne',
        contactEmail: 'jeanne@exemple.test',
      },
    );
    const id = hex();
    site.deposer([
      {
        id,
        invitation: test.invitationId,
        type: 'premier',
        recueLe: '2026-10-20T09:00:00.000Z',
        version: '1.0',
        parametres: {},
        reponses: {},
        calcul: {},
        ecran: ecranDeTest('Atelier Fictif'),
      },
    ]);

    const r = await releverTestsVma(t.app.db, {
      url: SITE,
      token: JETON,
      fetch: site.fetch,
      ecriture: { secretsDir: './secrets/inexistant', realWrites: false },
    });
    expect(r.rattaches).toBe(1);

    const [sujet] = (
      await t.owner.pool.query<{ resume: string; instance_id: string }>(
        "select resume, instance_id from sujets where origine = 'test-vma'",
      )
    ).rows;
    expect(sujet?.instance_id).toBe(mandat.id);
    expect(sujet?.resume).toContain('Brouillon du résultat non créé');
    expect(site.acquittes).toEqual([[id]]);
  });

  it('sans e-mail de contact, la relève le signale et ne tente pas de brouillon', async () => {
    const site = faux();
    const test = await creerInvitation(
      t.app.db,
      { url: SITE, token: JETON, fetch: site.fetch },
      { instanceId: mandat.id, entrepriseNom: 'Sans contact', type: 'essai' },
    );
    site.deposer([
      {
        id: hex(),
        invitation: test.invitationId,
        type: 'essai',
        recueLe: '2026-10-20T09:00:00.000Z',
        version: '1.0',
        parametres: {},
        reponses: {},
        calcul: {},
        ecran: ecranDeTest('Sans contact'),
      },
    ]);
    await releverTestsVma(t.app.db, {
      url: SITE,
      token: JETON,
      fetch: site.fetch,
      ecriture: { secretsDir: './secrets/inexistant', realWrites: false },
    });
    const [sujet] = (
      await t.owner.pool.query<{ resume: string }>(
        "select resume from sujets where origine = 'test-vma'",
      )
    ).rows;
    expect(sujet?.resume).toContain('Aucun e-mail de contact');
  });
});

describe('routes du Test de VMA', () => {
  let t: TestApp;
  let instance: Instance;

  beforeAll(async () => {
    t = await setupTestApp();
    await createInstance(t.owner.db, {
      slug: 'routes-propre',
      nom: 'Mon activité',
      type: 'propre',
    });
    instance = await createInstance(t.owner.db, {
      slug: 'routes-mandat',
      nom: 'Mandat',
      type: 'mandat',
    });
  });

  afterAll(async () => {
    await t.drop();
  });

  const serveur = (vma: { url: string; token: string } | null, fetch?: typeof globalThis.fetch) => {
    const app = Fastify();
    registerVmaRoutes(app, {
      db: t.app.db,
      connexionDeps: { secretsDir: './secrets/inexistant', realWrites: false },
      vma,
      ...(fetch ? { fetch } : {}),
    });
    return app;
  };

  it('refuse la création tant que le Test de VMA n’est pas configuré', async () => {
    const app = serveur(null);
    const res = await app.inject({
      method: 'POST',
      url: `/api/i/${instance.slug}/vma/tests`,
      payload: { entrepriseNom: 'Atelier Fictif', type: 'premier' },
    });
    expect(res.statusCode).toBe(503);
    expect((JSON.parse(res.body) as { error: string }).error).toContain('VMA_OS_TOKEN');
  });

  it('crée une invitation, la liste, puis la révoque', async () => {
    const site = faux();
    const app = serveur({ url: SITE, token: JETON }, site.fetch);
    const cree = await app.inject({
      method: 'POST',
      url: `/api/i/${instance.slug}/vma/tests`,
      payload: {
        entrepriseNom: 'Atelier Fictif',
        type: 'premier',
        contactEmail: 'jeanne@exemple.test',
      },
    });
    expect(cree.statusCode).toBe(201);
    const test = JSON.parse(cree.body) as {
      id: string;
      lien: string;
      statut: string;
      contactEmail: string;
    };
    expect(test.statut).toBe('envoyee');
    expect(test.lien).toContain('/test-vma?i=');
    expect(test.contactEmail).toBe('jeanne@exemple.test');

    const liste = await app.inject({ method: 'GET', url: `/api/i/${instance.slug}/vma/tests` });
    expect((JSON.parse(liste.body) as { id: string }[]).map((x) => x.id)).toContain(test.id);

    const revoque = await app.inject({
      method: 'POST',
      url: `/api/i/${instance.slug}/vma/tests/${test.id}/revoquer`,
    });
    expect(revoque.statusCode).toBe(200);
    expect(revoque.json()).toMatchObject({ statut: 'revoquee' });
  });

  it('refuse une adresse de contact invalide, sans appeler le site', async () => {
    const site = faux();
    const app = serveur({ url: SITE, token: JETON }, site.fetch);
    const res = await app.inject({
      method: 'POST',
      url: `/api/i/${instance.slug}/vma/tests`,
      payload: {
        entrepriseNom: 'Atelier Fictif',
        type: 'premier',
        contactEmail: 'pas-une-adresse',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('répond 404 pour une instance inconnue', async () => {
    const app = serveur({ url: SITE, token: JETON }, faux().fetch);
    const res = await app.inject({ method: 'GET', url: '/api/i/inconnue/vma/tests' });
    expect(res.statusCode).toBe(404);
  });
});
