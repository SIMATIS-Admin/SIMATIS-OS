import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { fabrique } from '../../test/transfert.js';
import { buildApp } from '../app.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { createToken } from '../mcp/tokens.js';

describe('Interface d’enregistrement des visios', () => {
  let t: TestApp;
  let app: ReturnType<typeof buildApp>;
  let a: Instance;
  let runner: string;
  const son = Buffer.from('son-fictif');
  const maintenant = () => new Date();
  const base = '/api/i/rte-a/visio';
  const entetes = (extra: Record<string, string> = {}) => ({
    'content-type': 'audio/webm;codecs=opus',
    'x-debut-ms': '0',
    ...extra,
  });
  const rdv = (id: string) => `${base}/rendez-vous/${encodeURIComponent(id)}`;

  beforeAll(async () => {
    t = await setupTestApp();
    a = await createInstance(t.owner.db, { slug: 'rte-a', nom: 'A', type: 'mandat' });
    await createInstance(t.owner.db, { slug: 'rte-b', nom: 'B', type: 'mandat' });
    const debut = new Date(maintenant().getTime() - 10 * 60_000);
    const fin = new Date(maintenant().getTime() + 50 * 60_000);
    await fabrique(t).insere(a, 'rendez_vous', 'event_id, titre, debut, fin, statut', [
      'os:rte-1',
      'V - Atelier Fictif x Simatis',
      debut,
      fin,
      'rdv',
    ]);
    runner = (await createToken(t.owner.db, { nom: 'runner', portee: 'runner' })).token;
    app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test' });
  });
  afterAll(async () => {
    await app.close();
    await t.drop();
  });

  const ouvrir = async () =>
    (
      await app.inject({
        method: 'POST',
        url: `${base}/sessions`,
        payload: { rdvId: 'os:rte-1' },
      })
    ).json<{ id: string }>().id;
  const envoyer = (id: string, piste: string, rang: number, payload: Buffer = son) =>
    app.inject({
      method: 'PUT',
      url: `${base}/sessions/${id}/morceaux/${piste}/${rang}`,
      headers: entetes({ 'x-debut-ms': String(rang * 30_000) }),
      payload,
    });
  const exec = (method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${runner}` }, payload });

  it('liste les rendez-vous proches avec leur lien de visio', async () => {
    const r = await app.inject({ method: 'GET', url: `${base}/rendez-vous` });
    expect(r.statusCode).toBe(200);
    expect(r.json<{ id: string; titre: string }[]>()).toEqual([
      expect.objectContaining({ id: 'os:rte-1', titre: 'V - Atelier Fictif x Simatis' }),
    ]);
  });

  it('mène une visio du premier morceau au transcript', async () => {
    const id = await ouvrir();
    expect((await envoyer(id, 'moi', 0)).statusCode).toBe(204);
    expect((await envoyer(id, 'autres', 0)).statusCode).toBe(204);
    const fin = await app.inject({ method: 'POST', url: `${base}/sessions/${id}/fin` });
    expect(fin.json()).toMatchObject({ statut: 'clos' });

    const attente = (await exec('GET', '/api/runner/transcriptions')).json<
      { instance: string; enregistrementId: string; piste: string; rang: number; audio: string }[]
    >();
    const miens = attente.filter((m) => m.enregistrementId === id);
    expect(miens).toHaveLength(2);
    expect(Buffer.from(miens[0]?.audio ?? '', 'base64').equals(son)).toBe(true);

    for (const m of miens) {
      const texte = m.piste === 'moi' ? 'Bonjour.' : 'Bonjour à vous.';
      const r = await exec('POST', `/api/runner/transcriptions/${id}/${m.piste}/${m.rang}`, {
        instance: m.instance,
        texte,
      });
      expect(r.statusCode).toBe(200);
    }
    const lue = await app.inject({ method: 'GET', url: `${base}/sessions/${id}` });
    expect(lue.json()).toMatchObject({
      statut: 'transcrit',
      transcript: 'Moi : Bonjour.\nAutres : Bonjour à vous.',
    });
    const derniere = await app.inject({ method: 'GET', url: `${rdv('os:rte-1')}/session` });
    expect(derniere.json()).toMatchObject({ id, statut: 'transcrit' });
  });

  it('refuse un rendez-vous inconnu, une piste inconnue et un morceau trop gros', async () => {
    const inconnu = await app.inject({
      method: 'POST',
      url: `${base}/sessions`,
      payload: { rdvId: 'os:absent' },
    });
    expect(inconnu.statusCode).toBe(404);
    const id = await ouvrir();
    expect((await envoyer(id, 'voisin', 0)).statusCode).toBe(400);
    expect((await envoyer(id, 'moi', 1, Buffer.alloc(5_000_001))).statusCode).toBe(413);
  });

  it('cloisonne les sessions par instance', async () => {
    const id = await ouvrir();
    const autre = await app.inject({ method: 'GET', url: `/api/i/rte-b/visio/sessions/${id}` });
    expect(autre.statusCode).toBe(404);
  });

  it('ferme l’interface de l’exécuteur sans son jeton', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/runner/transcriptions' });
    expect(r.statusCode).toBe(401);
  });
});
