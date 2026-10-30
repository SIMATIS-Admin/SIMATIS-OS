import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { buildApp } from '../app.js';
import { prendre, repondre, viderFile, type Resultat } from '../cerveau/file.js';
import { withInstance } from '../db/context.js';
import { createInstance, setModule } from '../instances/service.js';
import { deposerSujet } from './depot.js';

const CHEMIN = 'echanges/2026-10-29-2141-christophe-fictif.md';
const corps = { sujet: 'Re : Point fictif', corps: 'Réponse fictive.' };

describe('Inbox : répondre à un message de l’espace partagé (API)', () => {
  let t: TestApp;
  let secretsDir: string;
  let app: ReturnType<typeof buildApp>;

  const refs = new Map<string, Awaited<ReturnType<typeof instance>>>();
  const instance = async (slug: string, type: 'propre' | 'prospect', module: boolean) => {
    const i = await createInstance(t.owner.db, { slug, nom: slug, type });
    if (module) await setModule(t.owner.db, slug, 'cerveau', true);
    return i;
  };
  const deposer = async (slug: string, cle: string) => {
    const i = refs.get(slug);
    if (!i) throw new Error(slug);
    return withInstance(
      t.app.db,
      i.id,
      async (tx) =>
        (
          await deposerSujet(tx, {
            type: 'mail_a_repondre',
            titre: `Sujet ${cle}`,
            origine: 'messagerie',
            source: 'routine',
            sourceId: cle,
          })
        ).id,
    );
  };
  const post = (slug: string, id: string, payload: unknown) =>
    app.inject({
      method: 'POST',
      url: `/api/i/${slug}/sujets/${id}/repondre`,
      payload: payload as object,
    });
  // Le runner du poste : prend la demande en file et y répond.
  const passerRunner = async (resultat: Resultat) => {
    await new Promise((r) => setTimeout(r, 50));
    for (const { id } of prendre()) repondre(id, resultat);
  };

  beforeAll(async () => {
    t = await setupTestApp();
    secretsDir = await mkdtemp(path.join(tmpdir(), 'simatis-repondre-'));
    app = buildApp({
      pool: t.app.pool,
      db: t.app.db,
      version: 'test',
      secretsDir,
      realWrites: false,
    });
    refs.set('rp-ok', await instance('rp-ok', 'propre', true));
    refs.set('rp-sans', await instance('rp-sans', 'propre', false));
    refs.set('rp-demo', await instance('rp-demo', 'prospect', true));
  });
  afterAll(async () => {
    await rm(secretsDir, { recursive: true, force: true });
    await t.drop();
  });
  afterEach(() => viderFile());

  it('dépose la réponse puis renvoie l’entrée traitée', async () => {
    const id = await deposer('rp-ok', `partage:${CHEMIN}`);
    const attente = post('rp-ok', id, corps);
    await passerRunner({ ok: true, chemin: 'echanges/reponse.md' });
    const r = await attente;
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ id, statut: 'traite', partage: { chemin: CHEMIN } });
  });

  it('refuse un sujet ou un message vide sans rien demander au runner', async () => {
    const id = await deposer('rp-ok', `partage:${CHEMIN}-vide`);
    expect((await post('rp-ok', id, { sujet: ' ', corps: 'x' })).statusCode).toBe(400);
    expect((await post('rp-ok', id, { sujet: 'x', corps: '' })).statusCode).toBe(400);
    expect(prendre()).toHaveLength(0);
  });

  it('refuse une démo et une instance sans le module', async () => {
    const demo = await deposer('rp-demo', `partage:${CHEMIN}`);
    expect((await post('rp-demo', demo, corps)).statusCode).toBe(403);
    const sans = await deposer('rp-sans', `partage:${CHEMIN}`);
    expect((await post('rp-sans', sans, corps)).statusCode).toBe(403);
  });

  it('répond 404 pour un id inconnu et 409 pour une entrée sans message source', async () => {
    expect((await post('rp-ok', '00000000-0000-4000-8000-000000000000', corps)).statusCode).toBe(
      404,
    );
    const autre = await deposer('rp-ok', 'cle-autre');
    expect((await post('rp-ok', autre, corps)).statusCode).toBe(409);
  });

  it('répond 502 avec le motif quand l’espace partagé refuse, et laisse l’entrée à traiter', async () => {
    const id = await deposer('rp-ok', `partage:${CHEMIN}-refus`);
    const attente = post('rp-ok', id, corps);
    await passerRunner({ ok: false, erreur: 'refus fictif' });
    const r = await attente;
    expect(r.statusCode).toBe(502);
    expect(r.json()).toEqual({ error: 'refus fictif' });
    const liste = await app.inject({ method: 'GET', url: '/api/i/rp-ok/inbox?filtre=tout' });
    expect(liste.json<{ id: string; statut: string }[]>().find((s) => s.id === id)?.statut).toBe(
      'a_traiter',
    );
  });
});
