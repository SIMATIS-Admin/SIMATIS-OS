import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { creerClient, relaisSimule, type Client } from 'os-agents-relay';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { buildApp } from '../app.js';
import { createInstance, getInstanceBySlug } from '../instances/service.js';
import { loadInstanceSecrets } from '../secrets.js';
import { tourPartenaires } from './releve.js';
import './types-propositions.js';

type Ecran = {
  peutInviter: boolean;
  invitations: { lien: string; email: string | null }[];
  partenaires: { nom: string }[];
};

// Every name and value below is fictitious.
describe('Partenaires : inviter depuis SIMATIS OS', () => {
  let t: TestApp;
  let app: FastifyInstance;
  let sansCle: FastifyInstance;
  let fermee: FastifyInstance;
  let secretsDir: string;
  let relais: ReturnType<typeof relaisSimule>;
  let partenaire: Client;
  let appels: string[];

  const ecran = async (a: FastifyInstance, slug: string) =>
    (await a.inject({ method: 'GET', url: `/api/i/${slug}/partenaires` })).json<Ecran>();
  const inviter = (a: FastifyInstance, slug: string, payload: Record<string, unknown> = {}) =>
    a.inject({ method: 'POST', url: `/api/i/${slug}/partenaires/invitations`, payload });

  beforeAll(async () => {
    t = await setupTestApp();
    secretsDir = await mkdtemp(path.join(tmpdir(), 'simatis-invitations-'));
    for (const slug of ['mandat-a', 'mandat-b', 'mandat-c']) {
      await createInstance(t.owner.db, {
        slug,
        nom: `Mandat ${slug.slice(-1).toUpperCase()}`,
        type: 'mandat',
        config: { ecrituresReelles: true },
      });
    }
    relais = relaisSimule({ cle: 'cle-fictive' });
    appels = [];
    const fetchRelais: typeof fetch = (entree, init) => {
      appels.push(
        `${init?.method ?? 'GET'} ${new URL(entree instanceof Request ? entree.url : entree).pathname}`,
      );
      return relais.fetch(entree, init);
    };
    const base = { pool: t.app.pool, db: t.app.db, version: 'test', secretsDir };
    const deps = { url: relais.url, fetch: fetchRelais };
    app = buildApp({
      ...base,
      realWrites: true,
      relais: { ...deps, cleInscription: 'cle-fictive' },
    });
    sansCle = buildApp({ ...base, realWrites: true, relais: deps });
    fermee = buildApp({
      ...base,
      realWrites: false,
      relais: { ...deps, cleInscription: 'cle-fictive' },
    });
    partenaire = creerClient({ url: relais.url, fetch: relais.fetch });
    await partenaire.inscrire({ nom: 'OS Client · Essai', cle_inscription: 'cle-fictive' });
  });

  afterAll(async () => {
    await app.close();
    await sansCle.close();
    await fermee.close();
    await rm(secretsDir, { recursive: true, force: true });
    await t.drop();
  });

  it('cannot invite without a node nor the registration key, and says so', async () => {
    expect((await ecran(sansCle, 'mandat-c')).peutInviter).toBe(false);
    const res = await inviter(sansCle, 'mandat-c');
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toMatch(/RELAIS_CLE_INSCRIPTION/);
  });

  it('refuses to invite while real writes are closed, without calling the relay', async () => {
    appels = [];
    const res = await inviter(fermee, 'mandat-a');
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toMatch(/Écritures réelles désactivées/);
    expect(appels).toEqual([]);
    expect((await loadInstanceSecrets(secretsDir, 'mandat-a')).RELAIS_NOEUD).toBeUndefined();
  });

  it('refuses an invalid email', async () => {
    const res = await inviter(app, 'mandat-a', { email: 'pas-un-email' });
    expect(res.statusCode).toBe(400);
  });

  it('registers with the key, then lists the pending invitation until the partner accepts', async () => {
    expect((await ecran(app, 'mandat-a')).peutInviter).toBe(true);
    const res = await inviter(app, 'mandat-a', { email: 'contact@client.example' });
    expect(res.statusCode).toBe(200);
    const { lien } = res.json<{ invitation: { lien: string } }>().invitation;
    expect(lien).toMatch(/\/invitations\/[A-Z2-7]{24}$/);

    const secrets = await loadInstanceSecrets(secretsDir, 'mandat-a');
    expect(secrets.RELAIS_NOEUD).toBeTruthy();
    expect(
      (relais.noeuds.get(secrets.RELAIS_NOEUD ?? '') as { nom: string } | undefined)?.nom,
    ).toBe('SIMATIS OS · Mandat A');
    const avant = await ecran(app, 'mandat-a');
    expect(avant.invitations).toEqual([
      expect.objectContaining({ lien, email: 'contact@client.example' }),
    ]);
    expect(JSON.stringify(avant)).not.toContain(secrets.RELAIS_SECRET);

    await partenaire.accepter(lien);
    const instance = await getInstanceBySlug(t.app.db, 'mandat-a');
    if (!instance) throw new Error('instance absente');
    await tourPartenaires(t.app.db, instance, {
      url: relais.url,
      secretsDir,
      realWrites: true,
      fetch: relais.fetch,
    });
    const apres = await ecran(app, 'mandat-a');
    expect(apres.invitations).toEqual([]);
    expect(apres.partenaires.map((p) => p.nom)).toEqual(['OS Client · Essai']);
  });

  it('invites again with the node already registered, without the key', async () => {
    appels = [];
    const res = await inviter(sansCle, 'mandat-a');
    expect(res.statusCode).toBe(200);
    expect(appels).toEqual(['POST /invitations']);
    expect((await ecran(sansCle, 'mandat-a')).invitations).toEqual([
      expect.objectContaining({ email: null }),
    ]);
  });

  it('reports a key refused by the relay', async () => {
    const mauvaise = buildApp({
      pool: t.app.pool,
      db: t.app.db,
      version: 'test',
      secretsDir,
      realWrites: true,
      relais: { url: relais.url, fetch: relais.fetch, cleInscription: 'mauvaise-cle' },
    });
    const res = await inviter(mauvaise, 'mandat-b');
    await mauvaise.close();
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toMatch(/clé d'inscription refusée/);
    expect((await loadInstanceSecrets(secretsDir, 'mandat-b')).RELAIS_NOEUD).toBeUndefined();
  });
});
