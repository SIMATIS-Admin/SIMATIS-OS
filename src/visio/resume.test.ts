import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { fabrique } from '../../test/transfert.js';
import { buildApp } from '../app.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { createToken } from '../mcp/tokens.js';

describe('Résumé d’une visio enregistrée', () => {
  let t: TestApp;
  let app: ReturnType<typeof buildApp>;
  let a: Instance;
  let runner: string;
  const base = '/api/i/res-a/visio';
  const exec = (method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${runner}` }, payload });

  // Une visio terminée : session transcrite, avec son texte.
  const visioTranscrite = async (eventId: string, transcript: string) => {
    const rdv = await fabrique(t).insere(a, 'rendez_vous', 'event_id, titre, statut', [
      eventId,
      `Visio ${eventId}`,
      'rdv',
    ]);
    return fabrique(t).insere(a, 'enregistrements_visio', 'rendez_vous_id, statut, transcript', [
      rdv,
      'transcrit',
      transcript,
    ]);
  };

  beforeAll(async () => {
    t = await setupTestApp();
    a = await createInstance(t.owner.db, { slug: 'res-a', nom: 'A', type: 'mandat' });
    await createInstance(t.owner.db, { slug: 'res-b', nom: 'B', type: 'mandat' });
    runner = (await createToken(t.owner.db, { nom: 'runner', portee: 'runner' })).token;
    app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test' });
  });
  afterAll(async () => {
    await app.close();
    await t.drop();
  });

  it('propose à l’exécuteur les visios transcrites sans résumé, avec leur texte', async () => {
    const id = await visioTranscrite('os:res-1', 'Moi : Bonjour.\nAutres : Bonjour à vous.');
    await visioTranscrite('os:res-vide', '');
    const r = await exec('GET', '/api/runner/resumes');
    const mes = r.json<{ id: string; instance: string; titre: string; transcript: string }[]>();
    expect(mes.filter((m) => m.instance === 'res-a')).toEqual([
      expect.objectContaining({
        id,
        titre: 'Visio os:res-1',
        transcript: 'Moi : Bonjour.\nAutres : Bonjour à vous.',
        // Pour dater la réunion et nommer ses participants dans le compte rendu.
        debut: expect.any(String) as unknown,
        participants: [],
      }),
    ]);
  });

  it('enregistre le résumé et dépose une seule entrée dans l’Inbox', async () => {
    const id = await visioTranscrite('os:res-2', 'Moi : Texte fictif.');
    for (let i = 0; i < 2; i++) {
      const r = await exec('POST', `/api/runner/resumes/${id}`, {
        instance: 'res-a',
        resume: 'Résumé fictif de la visio.',
      });
      expect(r.statusCode).toBe(200);
    }
    const lue = await app.inject({ method: 'GET', url: `${base}/sessions/${id}` });
    expect(lue.json()).toMatchObject({ resume: 'Résumé fictif de la visio.' });
    const sujets = await t.owner.pool.query(
      "select type, titre, resume from sujets where source = 'visio' and source_id = $1",
      [id],
    );
    expect(sujets.rows).toEqual([
      {
        type: 'compte_rendu',
        titre: 'Résumé de la visio : Visio os:res-2',
        resume: 'Résumé fictif de la visio.',
      },
    ]);
    const encore = await exec('GET', '/api/runner/resumes');
    expect(encore.json<{ id: string }[]>().map((m) => m.id)).not.toContain(id);
  });

  it('range le résumé dans l’entrée « compte rendu » déjà ouverte du rendez-vous, sans doublon', async () => {
    const id = await visioTranscrite('os:res-5', 'Moi : Texte fictif.');
    await fabrique(t).insere(a, 'sujets', 'type, titre, origine, source, source_id', [
      'compte_rendu',
      'Rédiger le compte rendu de Visio os:res-5',
      'agenda',
      'routine',
      'agenda:os:res-5',
    ]);
    await exec('POST', `/api/runner/resumes/${id}`, { instance: 'res-a', resume: 'Résumé rangé.' });
    const visio = await t.owner.pool.query(
      "select 1 from sujets where source = 'visio' and source_id = $1",
      [id],
    );
    expect(visio.rows).toHaveLength(0);
    const agenda = await t.owner.pool.query<{ texte: string }>(
      "select compte_rendu_prepare->>'texte' as texte from sujets where source_id = 'agenda:os:res-5'",
    );
    expect(agenda.rows[0]?.texte).toBe('Résumé rangé.');
  });

  it('refuse un résumé vide, une instance inconnue et l’absence de jeton', async () => {
    const id = await visioTranscrite('os:res-3', 'Moi : Texte.');
    const vide = await exec('POST', `/api/runner/resumes/${id}`, {
      instance: 'res-a',
      resume: ' ',
    });
    expect(vide.statusCode).toBe(400);
    const inconnue = await exec('POST', `/api/runner/resumes/${id}`, {
      instance: 'nulle-part',
      resume: 'x',
    });
    expect(inconnue.statusCode).toBe(404);
    const sans = await app.inject({ method: 'GET', url: '/api/runner/resumes' });
    expect(sans.statusCode).toBe(401);
  });

  it('ne pose pas le résumé d’une session d’une autre instance', async () => {
    const id = await visioTranscrite('os:res-4', 'Moi : Texte.');
    const r = await exec('POST', `/api/runner/resumes/${id}`, { instance: 'res-b', resume: 'x' });
    expect(r.statusCode).toBe(404);
  });
});
