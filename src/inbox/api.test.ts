import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { buildApp } from '../app.js';
import { withInstance } from '../db/context.js';
import { seedDemoIfEmpty } from '../demo/seed.js';
import { archiveInstance, listInstances } from '../instances/service.js';
import { propose } from '../propositions/service.js';
import '../pilotage/types-propositions.js';
import { deposerSujet } from './depot.js';

type Sujet = { id: string; titre: string; instance: { slug: string }; proposition: unknown };

describe('Inbox : API', () => {
  let t: TestApp;
  let secretsDir: string;
  let app: ReturnType<typeof buildApp>;

  const req = async (method: 'GET' | 'POST', url: string, payload?: unknown) => {
    const r = await app.inject({ method, url, payload: payload as object });
    return { status: r.statusCode, body: r.json<unknown>() };
  };
  const instance = async (slug: string) => {
    const i = (await listInstances(t.owner.db, { includeArchived: true })).find(
      (x) => x.slug === slug,
    );
    if (!i) throw new Error(slug);
    return i;
  };
  const deposer = async (slug: string, cle: string) => {
    const i = await instance(slug);
    return withInstance(t.app.db, i.id, (tx) =>
      deposerSujet(tx, {
        type: 'mail_a_repondre',
        titre: `Sujet ${cle}`,
        origine: 'messagerie',
        source: 'routine',
        sourceId: cle,
      }),
    );
  };
  const inbox = async (slug: string, filtre = 'tout') =>
    (await req('GET', `/api/i/${slug}/inbox?filtre=${filtre}`)).body as Sujet[];

  beforeAll(async () => {
    t = await setupTestApp();
    await seedDemoIfEmpty(t.owner.db);
    secretsDir = await mkdtemp(path.join(tmpdir(), 'simatis-inbox-api-'));
    app = buildApp({
      pool: t.app.pool,
      db: t.app.db,
      version: 'test',
      secretsDir,
      realWrites: false,
    });
    await deposer('simatis', 'api-simatis');
    await deposer('helioval', 'api-helioval');
    await deposer('demo', 'api-demo');
    await deposer('aquaterra', 'api-archive');
  });

  afterAll(async () => {
    await app.close();
    await t.drop();
    await rm(secretsDir, { recursive: true, force: true });
  });

  it('lists the overview of simatis with helioval subjects and no demo subject', async () => {
    const titres = (await inbox('simatis')).map((s) => `${s.instance.slug}:${s.titre}`);
    expect(titres).toContain('simatis:Sujet api-simatis');
    expect(titres).toContain('helioval:Sujet api-helioval');
    expect(titres.some((x) => x.startsWith('demo:'))).toBe(false);
    expect((await req('GET', '/api/i/simatis/inbox/compteur')).body).toEqual({
      n: titres.length,
    });
  });

  it('acts on a mandate subject through the mandate slug, 404 through simatis', async () => {
    const { id } = await deposer('helioval', 'api-action');
    expect((await req('POST', `/api/i/simatis/sujets/${id}/traite`)).status).toBe(404);
    const ok = await req('POST', `/api/i/helioval/sujets/${id}/traite`);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ statut: 'traite', instance: { slug: 'helioval' } });
    expect((await req('POST', `/api/i/helioval/sujets/${id}/traite`)).status).toBe(409);
    expect((await req('POST', `/api/i/helioval/sujets/${id}/a-traiter`)).body).toMatchObject({
      statut: 'a_traiter',
    });
  });

  it('turns a subject into a task through the API', async () => {
    const { id } = await deposer('helioval', 'api-tache');
    const r = await req('POST', `/api/i/helioval/sujets/${id}/tache`, { titre: 'Rappeler' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ statut: 'tache' });
  });

  it('adds an entry by hand to the instance of the slug, and refuses an empty title', async () => {
    const r = await req('POST', '/api/i/helioval/sujets', {
      titre: 'Appeler le fournisseur',
      resume: 'Avant jeudi',
      echeance: '2026-10-23T12:00:00+02:00',
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      titre: 'Appeler le fournisseur',
      type: 'autre',
      origine: 'os',
      statut: 'a_traiter',
      instance: { slug: 'helioval' },
    });
    expect((await inbox('helioval')).some((s) => s.titre === 'Appeler le fournisseur')).toBe(true);
    // Two identical entries stay two entries: each has its own key.
    await req('POST', '/api/i/helioval/sujets', { titre: 'Appeler le fournisseur' });
    expect(
      (await inbox('helioval')).filter((s) => s.titre === 'Appeler le fournisseur'),
    ).toHaveLength(2);
    expect((await req('POST', '/api/i/helioval/sujets', { titre: '  ' })).status).toBe(400);
    expect(
      (await req('POST', '/api/i/helioval/sujets', { titre: 'x', type: 'devis' })).status,
    ).toBe(400);
  });

  it('returns 404 for a subject of an archived mandate', async () => {
    await archiveInstance(t.owner.db, 'aquaterra');
    expect((await inbox('simatis')).some((s) => s.instance.slug === 'aquaterra')).toBe(false);
    const { id } = await deposer('aquaterra', 'api-archive');
    expect((await req('POST', `/api/i/aquaterra/sujets/${id}/traite`)).status).toBe(404);
  });

  it('validating a proposition removes its subject from the list', async () => {
    const helioval = await instance('helioval');
    const p = await withInstance(t.app.db, helioval.id, (tx) =>
      propose(
        tx,
        { instance: helioval, realWrites: false },
        {
          type: 'note.second_cerveau',
          contenu: { titre: 'Note fictive', texte: 'x' },
          auteur: 'os',
        },
      ),
    );
    const avant = await inbox('helioval', 'a_valider');
    const sujet = avant.find((s) => s.titre === 'Note fictive');
    expect(sujet?.proposition).toMatchObject({ id: p.id, statut: 'proposee' });
    const decision = await req('POST', `/api/i/helioval/propositions/${p.id}/decision`, {
      decision: 'ecarter',
    });
    expect(decision.status).toBe(200);
    expect((await inbox('helioval', 'a_valider')).some((s) => s.id === sujet?.id)).toBe(false);
  });

  it('rejects an invalid task body with 400 and an unknown subject with 404', async () => {
    const { id } = await deposer('helioval', 'api-invalide');
    expect((await req('POST', `/api/i/helioval/sujets/${id}/tache`, { titre: '' })).status).toBe(
      400,
    );
    expect((await req('POST', '/api/i/helioval/sujets/pas-un-id/traite')).status).toBe(404);
  });
});
