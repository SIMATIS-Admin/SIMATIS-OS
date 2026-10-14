import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { buildApp } from '../app.js';
import { GoogleError } from '../connecteurs/google/oauth.js';
import { createInstance, setModule } from '../instances/service.js';
import { writeGoogleAppSecret } from '../secrets.js';
import {
  assembler,
  lignes,
  messageLisible,
  periodes,
  requetes,
  type RapportSite,
} from './analytics.js';

const SECRET = 'GOCSPX-fictif-0000-1111';
const ACCES = 'acces-analytics-fictif';

describe('periods', () => {
  it('takes the last 28 full days, the 28 before, and twelve calendar months', () => {
    // 14 October, 00:30 in Paris (still the 13th in UTC): today in Paris is the 14th.
    const p = periodes(new Date('2026-10-13T22:30:00Z'));
    expect(p.periode).toEqual({ du: '2026-09-16', au: '2026-10-13' });
    expect(p.precedente).toEqual({ du: '2026-08-19', au: '2026-09-15' });
    expect(p.douzeMois).toEqual({ du: '2025-11-01', au: '2026-10-13' });
  });

  it('crosses the new year', () => {
    const p = periodes(new Date('2027-01-05T10:00:00Z'));
    expect(p.periode).toEqual({ du: '2026-12-08', au: '2027-01-04' });
    expect(p.douzeMois.du).toBe('2026-02-01');
  });
});

// GA4 answers, shaped like batchRunReports, with fictive figures.
const report = (dims: string[], mets: string[], rows: [string[], string[]][]) => ({
  dimensionHeaders: dims.map((name) => ({ name })),
  metricHeaders: mets.map((name) => ({ name })),
  rows: rows.map(([d, m]) => ({
    dimensionValues: d.map((value) => ({ value })),
    metricValues: m.map((value) => ({ value })),
  })),
});
const KPI = [
  'activeUsers',
  'newUsers',
  'sessions',
  'engagementRate',
  'averageSessionDuration',
  'screenPageViews',
];
const REPORTS = [
  report(['dateRange'], KPI, [
    [['precedent'], ['200', '150', '260', '0.5', '80', '700']],
    [['actuel'], ['240', '190', '300', '0.62', '95.5', '820']],
  ]),
  report(
    ['yearMonth'],
    ['activeUsers', 'sessions'],
    [
      [['202609'], ['230', '290']],
      [['202610'], ['110', '130']],
    ],
  ),
  report(
    ['sessionDefaultChannelGroup'],
    ['sessions', 'engagementRate'],
    [
      [['Organic Search'], ['150', '0.7']],
      [['Direct'], ['90', '0.5']],
      [['Nouveau canal'], ['5', '0.1']],
    ],
  ),
  report(
    ['pagePath', 'pageTitle'],
    ['screenPageViews', 'activeUsers'],
    [
      [
        ['/', 'Accueil'],
        ['400', '200'],
      ],
    ],
  ),
  report(['sessionSource'], ['sessions'], [[['linkedin.com'], ['40']]]),
];

describe('report assembly', () => {
  it('turns GA rows into named values, zero when a figure is missing', () => {
    expect(lignes(REPORTS[4] ?? {})).toEqual([{ sessionSource: 'linkedin.com', sessions: '40' }]);
    expect(lignes({})).toEqual([]);
  });

  it('splits the two periods, translates the channels and adds the OS requests', () => {
    const now = new Date('2026-10-14T08:00:00Z');
    const p = periodes(now);
    const r = assembler(REPORTS, p, { actuel: 3, precedent: 1 }, now);
    expect(r.actuel).toEqual({
      visiteurs: 240,
      nouveaux: 190,
      sessions: 300,
      engagement: 0.62,
      dureeMoyenne: 95.5,
      pagesVues: 820,
    });
    expect(r.precedent.visiteurs).toBe(200);
    expect(r.mois).toEqual([
      { mois: '2026-09', visiteurs: 230, sessions: 290 },
      { mois: '2026-10', visiteurs: 110, sessions: 130 },
    ]);
    expect(r.canaux.map((c) => c.canal)).toEqual([
      'Recherche Google et autres moteurs',
      'Accès direct',
      'Nouveau canal',
    ]);
    expect(r.pages).toEqual([{ chemin: '/', titre: 'Accueil', vues: 400, visiteurs: 200 }]);
    expect(r.sources).toEqual([{ source: 'linkedin.com', sessions: 40 }]);
    expect(r.demandes).toEqual({ actuel: 3, precedent: 1 });
  });

  it('reads an empty property as zeros', () => {
    const now = new Date('2026-10-14T08:00:00Z');
    const r = assembler([{}, {}, {}, {}, {}], periodes(now), { actuel: 0, precedent: 0 }, now);
    expect(r.actuel.visiteurs).toBe(0);
    expect(r.canaux).toEqual([]);
  });

  it('asks Google for five reports at most (one batch)', () => {
    expect(requetes(periodes(new Date()))).toHaveLength(5);
  });
});

describe('readable Google errors', () => {
  it('names the action to take', () => {
    expect(
      messageLisible(new GoogleError('Google 403 : API has not been used in project 1', 403)),
    ).toMatch(/ne sont pas activées/);
    expect(messageLisible(new Error('refusé (400 : invalid_grant)'))).toMatch(/reconnectez/);
    expect(messageLisible(new GoogleError('Google 403 : User does not have', 403))).toMatch(
      /n’a pas accès/,
    );
  });
});

describe('Site web screen', () => {
  let t: TestApp;
  let app: FastifyInstance;
  let secretsDir: string;
  const appels: string[] = [];
  let dataDesactivee = false;

  beforeAll(async () => {
    t = await setupTestApp();
    await createInstance(t.owner.db, { slug: 'simatis', nom: 'SIMATIS', type: 'propre' });
    await setModule(t.owner.db, 'simatis', 'site-web', true);
    await createInstance(t.owner.db, { slug: 'mandat-a', nom: 'Mandat A', type: 'mandat' });
    secretsDir = await mkdtemp(path.join(tmpdir(), 'simatis-siteweb-'));
    await writeGoogleAppSecret(secretsDir, SECRET);

    // Three website requests picked up by the OS: two in the last 28 days, one before.
    const jours = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
    for (const n of [3, 10, 40]) {
      await t.owner.pool.query(
        `insert into sujets (instance_id, type, titre, origine, created_at)
         select id, 'autre', 'Demande fictive', 'site', $1 from instances where slug = 'simatis'`,
        [jours(n)],
      );
    }

    const googleFetch = (url: string, init: RequestInit) => {
      appels.push(url);
      if (url === 'https://oauth2.googleapis.com/token') {
        const params = new URLSearchParams(init.body as string);
        if (params.get('grant_type') === 'refresh_token') {
          return Promise.resolve(Response.json({ access_token: ACCES }));
        }
        return Promise.resolve(
          Response.json({ refresh_token: 'refresh-analytics-fictif', scope: 'analytics' }),
        );
      }
      if ((init.headers as Record<string, string>).authorization !== `Bearer ${ACCES}`) {
        return Promise.resolve(new Response('{}', { status: 401 }));
      }
      if (url.startsWith('https://analyticsadmin.googleapis.com/v1beta/accountSummaries')) {
        return Promise.resolve(
          Response.json({
            accountSummaries: [
              {
                displayName: 'Compte fictif',
                propertySummaries: [{ property: 'properties/123456', displayName: 'Site fictif' }],
              },
            ],
          }),
        );
      }
      if (url.endsWith('/properties/123456:batchRunReports')) {
        if (dataDesactivee) {
          return Promise.resolve(
            Response.json(
              { error: { message: 'Google Analytics Data API has not been used in project 1' } },
              { status: 403 },
            ),
          );
        }
        return Promise.resolve(Response.json({ reports: REPORTS }));
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    };
    app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test', secretsDir, googleFetch });
  });

  afterAll(async () => {
    await app.close();
    await t.drop();
    await rm(secretsDir, { recursive: true, force: true });
  });

  it('exists only where the site-web brick is on', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/i/mandat-a/site-web' });
    expect(res.statusCode).toBe(404);
    const start = await app.inject({
      method: 'POST',
      url: '/api/i/mandat-a/site-web/google/start',
      payload: {},
    });
    expect(start.statusCode).toBe(404);
  });

  it('connects an Analytics account of its own, picks the property, then reads the figures', async () => {
    const avant = await app.inject({ method: 'GET', url: '/api/i/simatis/site-web' });
    expect(avant.json()).toEqual({
      googleClientDisponible: true,
      connecte: false,
      propriete: null,
    });
    const sansCompte = await app.inject({ method: 'GET', url: '/api/i/simatis/site-web/rapport' });
    expect(sansCompte.statusCode).toBe(409);

    const start = await app.inject({
      method: 'POST',
      url: '/api/i/simatis/site-web/google/start',
      headers: { host: '127.0.0.1:4300' },
      payload: {},
    });
    const consent = new URL(start.json<{ url: string }>().url);
    // Analytics only: the mailbox scopes are not asked again.
    expect(consent.searchParams.get('scope')).toBe(
      'https://www.googleapis.com/auth/analytics.readonly',
    );
    const back = await app.inject({
      method: 'GET',
      url: `/oauth/google/callback?state=${consent.searchParams.get('state')}&code=code-fictif`,
    });
    expect(back.headers.location).toBe('/#/simatis/siteweb');
    const fichier = path.join(secretsDir, 'simatis.analytics.json');
    expect((await stat(fichier)).mode & 0o777).toBe(0o600);
    expect(await readFile(fichier, 'utf8')).toContain('refresh-analytics-fictif');
    // The mailbox connection is left alone.
    await expect(stat(path.join(secretsDir, 'simatis.google.json'))).rejects.toThrow();
    const { rows } = await t.owner.pool.query('select kind from connexions');
    expect(rows).toEqual([]);

    const etat = await app.inject({ method: 'GET', url: '/api/i/simatis/site-web' });
    expect(etat.json()).toMatchObject({ connecte: true });
    expect(etat.body).not.toContain('refresh-analytics-fictif');

    const proprietes = await app.inject({
      method: 'GET',
      url: '/api/i/simatis/site-web/proprietes',
    });
    expect(proprietes.json()).toEqual([
      { id: '123456', nom: 'Site fictif', compte: 'Compte fictif' },
    ]);

    const invalide = await app.inject({
      method: 'PUT',
      url: '/api/i/simatis/site-web/propriete',
      payload: { id: 'properties/../x', nom: 'X' },
    });
    expect(invalide.statusCode).toBe(400);
    const choix = await app.inject({
      method: 'PUT',
      url: '/api/i/simatis/site-web/propriete',
      payload: { id: '123456', nom: 'Site fictif' },
    });
    expect(choix.json()).toEqual({ proprieteId: '123456', proprieteNom: 'Site fictif' });

    const rapport = await app.inject({ method: 'GET', url: '/api/i/simatis/site-web/rapport' });
    expect(rapport.statusCode).toBe(200);
    const r = rapport.json<RapportSite>();
    expect(r.actuel.visiteurs).toBe(240);
    expect(r.demandes).toEqual({ actuel: 2, precedent: 1 });

    // Kept an hour, unless a refresh is asked.
    const lus = () => appels.filter((u) => u.endsWith(':batchRunReports')).length;
    expect(lus()).toBe(1);
    await app.inject({ method: 'GET', url: '/api/i/simatis/site-web/rapport' });
    expect(lus()).toBe(1);
    await app.inject({ method: 'GET', url: '/api/i/simatis/site-web/rapport?frais=1' });
    expect(lus()).toBe(2);

    dataDesactivee = true;
    const refus = await app.inject({
      method: 'GET',
      url: '/api/i/simatis/site-web/rapport?frais=1',
    });
    expect(refus.statusCode).toBe(409);
    expect(refus.json<{ error: string }>().error).toMatch(/ne sont pas activées/);
    dataDesactivee = false;
  });
});
