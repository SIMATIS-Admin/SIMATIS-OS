import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { buildApp } from '../app.js';
import fixtures from '../demo/fixtures.json' with { type: 'json' };
import { seedDemoIfEmpty } from '../demo/seed.js';

type Row = Record<string, unknown>;

describe('API instances, entreprises, contacts', () => {
  let t: TestApp;
  let app: FastifyInstance;

  const get = async (url: string) => {
    const response = await app.inject({ method: 'GET', url });
    return { status: response.statusCode, body: response.json<Row[] & Row>() };
  };
  const send = async (method: 'PUT' | 'PATCH' | 'POST', url: string, payload: unknown) => {
    const response = await app.inject({ method, url, payload: payload as object });
    return { status: response.statusCode, body: response.json<Row>() };
  };

  beforeAll(async () => {
    t = await setupTestApp();
    // The API runs as the restricted role, as in production.
    app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test' });
  });

  afterAll(async () => {
    await app.close();
    await t.drop();
  });

  it('seeds the fictive instances once, and only into an empty database', async () => {
    expect(await seedDemoIfEmpty(t.owner.db)).toBe(true);
    expect(await seedDemoIfEmpty(t.owner.db)).toBe(false);
    const { rows } = await t.owner.pool.query<{ n: number }>(
      'select count(*)::int as n from entreprises',
    );
    expect(rows[0]?.n).toBe(fixtures.reduce((n, f) => n + f.entreprises.length, 0));
  });

  it('lists instances grouped propre, mandat, prospect', async () => {
    const { status, body } = await get('/api/instances');
    expect(status).toBe(200);
    expect(body.map((i) => i.type)).toEqual(['propre', 'mandat', 'mandat', 'prospect']);
    expect(body[0]).toMatchObject({ slug: 'simatis', nom: 'SIMATIS' });
  });

  it('lists and searches companies of one instance', async () => {
    const all = await get('/api/i/simatis/entreprises');
    expect(all.body).toHaveLength(12);

    const { body } = await get('/api/i/simatis/entreprises?q=plast');
    expect(body.map((e) => e.nom)).toEqual(['Plasturgie Mornand']);
    expect(body[0]).toMatchObject({ nbContacts: 1 });
  });

  it('never returns another instance’s data, even when the search matches it', async () => {
    const helioval = await get('/api/i/helioval/entreprises');
    const helioName = String(helioval.body[0]?.nom);

    const { body } = await get(`/api/i/simatis/entreprises?q=${encodeURIComponent(helioName)}`);
    expect(body).toEqual([]);
  });

  it('searches contacts by email and returns their company', async () => {
    const { body } = await get('/api/i/simatis/contacts?q=k.haddad');
    expect(body).toEqual([
      expect.objectContaining({ nom: 'Karim Haddad', entreprise: 'Plasturgie Mornand' }),
    ]);
  });

  it('returns 404 for an unknown instance', async () => {
    const { status, body } = await get('/api/i/inconnue/contacts');
    expect(status).toBe(404);
    expect(body).toEqual({ error: 'Instance inconnue' });
  });

  it('returns 404 for the journal of an unknown instance (no fallback to another)', async () => {
    expect((await get('/api/i/inconnu/journal')).status).toBe(404);
  });

  it('shows the journal of the instance only', async () => {
    const { status, body } = await get('/api/i/helioval/journal');
    expect(status).toBe(200);
    expect(body.length).toBeGreaterThan(0);
    expect(body.every((e) => String(e.action).includes('Helioval'))).toBe(true);
  });

  it('returns only counters in the portfolio', async () => {
    const { body } = await get('/api/portefeuille');
    expect(body).toHaveLength(4);
    for (const row of body) {
      expect(Object.keys(row).sort()).toEqual(
        ['aValider', 'nom', 'rdv7j', 'routinesActives', 'slug', 'tachesEnRetard', 'type'].sort(),
      );
    }
  });

  it('keeps favourites per user, with the mockup default, and validates them', async () => {
    expect((await get('/api/preferences')).body).toEqual({
      favoris: ['pipeline', 'brief', 'prospection'],
    });
    const saved = await send('PUT', '/api/preferences', { favoris: ['contacts', 'pipeline'] });
    expect(saved.body).toEqual({ favoris: ['contacts', 'pipeline'] });
    expect((await get('/api/preferences')).body).toEqual({ favoris: ['contacts', 'pipeline'] });
    expect((await send('PUT', '/api/preferences', { favoris: ['<script>'] })).status).toBe(400);
  });

  it('renames a mandate, journals it, and refuses to rename the own activity', async () => {
    const renamed = await send('PATCH', '/api/i/aquaterra/instance', {
      nom: 'Aquaterra Équipements',
    });
    expect(renamed.body).toMatchObject({ slug: 'aquaterra', nom: 'Aquaterra Équipements' });
    expect((await get('/api/i/aquaterra/instance')).body).toMatchObject({
      nom: 'Aquaterra Équipements',
      type: 'mandat',
      statut: 'actif',
      ecrituresReelles: false,
    });
    const journal = await get('/api/i/aquaterra/journal');
    expect(String(journal.body[0]?.action)).toMatch(/renommée/);
    expect((await send('PATCH', '/api/i/simatis/instance', { nom: 'Autre' })).status).toBe(400);
    expect((await send('PATCH', '/api/i/aquaterra/instance', { nom: '' })).status).toBe(400);
  });

  it('opens a company sheet, but never one of another instance', async () => {
    const [plasturgie] = (await get('/api/i/simatis/entreprises?q=plast')).body;
    const id = String(plasturgie?.id);
    const fiche = await get(`/api/i/simatis/entreprises/${id}`);
    expect(fiche.status).toBe(200);
    expect(fiche.body).toMatchObject({ nom: 'Plasturgie Mornand' });
    expect((await get(`/api/i/helioval/entreprises/${id}`)).status).toBe(404);
    expect((await get('/api/i/simatis/entreprises/pas-un-uuid')).status).toBe(404);
  });

  it('creates a contact in an instance without CRM, and validates the fields', async () => {
    const created = await send('POST', '/api/i/aquaterra/contacts', {
      nom: 'Paul Brunet',
      fonction: 'Gérant',
      email: 'p.brunet@exemple.test',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ nom: 'Paul Brunet', source: 'natif' });
    expect((await send('POST', '/api/i/aquaterra/contacts', { nom: '' })).status).toBe(400);
    expect(
      (await send('POST', '/api/i/aquaterra/contacts', { nom: 'X', email: 'pas-un-email' })).status,
    ).toBe(400);
  });
});
