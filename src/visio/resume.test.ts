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

  // Une visio dont le rendez-vous invite une personne connue du CRM.
  const visioAvecInvite = async (eventId: string, email: string) => {
    const f = fabrique(t);
    const entreprise = await f.entreprise(a, 'Entreprise Fictive');
    const contact = await f.insere(a, 'contacts', 'nom, source, email, entreprise_id', [
      'Camille Fictive',
      'natif',
      email,
      entreprise,
    ]);
    const rdv = await f.insere(a, 'rendez_vous', 'event_id, titre, statut, participants', [
      eventId,
      `Visio ${eventId}`,
      'rdv',
      JSON.stringify([email]),
    ]);
    const id = await f.insere(a, 'enregistrements_visio', 'rendez_vous_id, statut, transcript', [
      rdv,
      'transcrit',
      'Moi : Texte fictif.',
    ]);
    return { id, contact };
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

  it('indique à l’exécuteur les interlocuteurs reconnus dans le CRM', async () => {
    const { id } = await visioAvecInvite('os:res-6', 'camille@exemple.test');
    const r = await exec('GET', '/api/runner/resumes');
    const visio = r.json<{ id: string; interlocuteurs: unknown }[]>().find((m) => m.id === id);
    expect(visio?.interlocuteurs).toEqual([
      { nom: 'Camille Fictive', entreprise: 'Entreprise Fictive' },
    ]);
  });

  it('dépose un compte rendu préparé avec son dossier et relie l’interlocuteur', async () => {
    const { id, contact } = await visioAvecInvite('os:res-7', 'camille7@exemple.test');
    await exec('POST', `/api/runner/resumes/${id}`, {
      instance: 'res-a',
      resume: 'Résumé complet fictif.',
    });
    const r = await t.owner.pool.query<{
      contact_id: string;
      prepare: { texte: string; dossier: { interlocuteurs: { nom: string }[] } };
    }>(
      "select contact_id, compte_rendu_prepare as prepare from sujets where source = 'visio' and source_id = $1",
      [id],
    );
    expect(r.rows[0]?.contact_id).toBe(contact);
    expect(r.rows[0]?.prepare.texte).toBe('Résumé complet fictif.');
    expect(r.rows[0]?.prepare.dossier.interlocuteurs[0]?.nom).toBe('Camille Fictive');
  });

  it('la suite lue par l’exécuteur devient des lignes du dossier, vérifiées contre l’agenda', async () => {
    const id = await visioTranscrite('os:res-suite', 'Moi : Texte fictif.');
    const debut = '2031-03-04T14:00:00.000Z';
    await fabrique(t).insere(a, 'rendez_vous', 'event_id, titre, debut, statut', [
      'ev-deja',
      'Diagnostic fictif',
      debut,
      'rdv',
    ]);
    const r = await exec('POST', `/api/runner/resumes/${id}`, {
      instance: 'res-a',
      resume: 'Résumé fictif.',
      suite: {
        rdv: { titre: 'Diagnostic', debut, certain: true },
        relance: { titre: 'Relancer', echeance: '2031-03-18', certain: false },
      },
    });
    expect(r.statusCode).toBe(200);
    const q = await t.owner.pool.query<{ suite: { genre: string; coche: boolean }[] }>(
      "select compte_rendu_prepare->'dossier'->'suite' as suite from sujets where source = 'visio' and source_id = $1",
      [id],
    );
    expect(q.rows[0]?.suite).toMatchObject([
      { genre: 'rdv', coche: false, dejaAgenda: { eventId: 'ev-deja' } },
      { genre: 'relance', coche: false, echeance: '2031-03-18' },
    ]);
  });

  it('une suite illisible est ignorée : le résumé est posé quand même', async () => {
    const id = await visioTranscrite('os:res-suite-ko', 'Moi : Texte fictif.');
    const r = await exec('POST', `/api/runner/resumes/${id}`, {
      instance: 'res-a',
      resume: 'Résumé fictif.',
      suite: { rdv: { titre: 'Sans date' } },
    });
    expect(r.statusCode).toBe(200);
    const q = await t.owner.pool.query<{ suite: unknown }>(
      "select compte_rendu_prepare->'dossier'->'suite' as suite from sujets where source = 'visio' and source_id = $1",
      [id],
    );
    expect(q.rows[0]?.suite ?? null).toBeNull();
  });

  it('une visio sans invité reconnu dépose un dossier sans interlocuteur, sans bloquer', async () => {
    const id = await visioTranscrite('os:res-8', 'Moi : Texte fictif.');
    await exec('POST', `/api/runner/resumes/${id}`, {
      instance: 'res-a',
      resume: 'Résumé fictif.',
    });
    const r = await t.owner.pool.query<{ dossier: { rdv: unknown; interlocuteurs: unknown[] } }>(
      "select compte_rendu_prepare->'dossier' as dossier from sujets where source = 'visio' and source_id = $1",
      [id],
    );
    expect(r.rows[0]?.dossier).toMatchObject({ interlocuteurs: [] });
  });

  it('le dossier suit le résumé rangé dans l’entrée ouverte de l’agenda', async () => {
    const { id } = await visioAvecInvite('os:res-9', 'camille9@exemple.test');
    await fabrique(t).insere(a, 'sujets', 'type, titre, origine, source, source_id', [
      'compte_rendu',
      'Rédiger le compte rendu de Visio os:res-9',
      'agenda',
      'routine',
      'agenda:os:res-9',
    ]);
    await exec('POST', `/api/runner/resumes/${id}`, { instance: 'res-a', resume: 'Résumé rangé.' });
    const r = await t.owner.pool.query<{ nom: string }>(
      "select compte_rendu_prepare->'dossier'->'interlocuteurs'->0->>'nom' as nom from sujets where source_id = 'agenda:os:res-9'",
    );
    expect(r.rows[0]?.nom).toBe('Camille Fictive');
  });

  it('ne remplace pas un compte rendu que Marc a déjà modifié, dossier compris', async () => {
    const { id } = await visioAvecInvite('os:res-10', 'camille10@exemple.test');
    await fabrique(t).insere(
      a,
      'sujets',
      'type, titre, origine, source, source_id, compte_rendu_prepare',
      [
        'compte_rendu',
        'Rédiger le compte rendu de Visio os:res-10',
        'agenda',
        'routine',
        'agenda:os:res-10',
        JSON.stringify({ texte: 'Texte corrigé par Marc.', prepareeLe: '2026-11-20T10:00:00Z' }),
      ],
    );
    await exec('POST', `/api/runner/resumes/${id}`, {
      instance: 'res-a',
      resume: 'Nouveau résumé.',
    });
    const r = await t.owner.pool.query<{ prepare: { texte: string; dossier?: unknown } }>(
      "select compte_rendu_prepare as prepare from sujets where source_id = 'agenda:os:res-10'",
    );
    expect(r.rows[0]?.prepare.texte).toBe('Texte corrigé par Marc.');
    expect(r.rows[0]?.prepare.dossier).toBeUndefined();
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
