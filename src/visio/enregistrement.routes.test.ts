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
  let b: Instance;
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
    b = await createInstance(t.owner.db, { slug: 'rte-b', nom: 'B', type: 'mandat' });
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

  it('montre en direct le texte déjà transcrit pendant que la session est ouverte', async () => {
    const id = await ouvrir();
    await envoyer(id, 'moi', 0);
    await envoyer(id, 'autres', 0);
    const r = await exec('POST', `/api/runner/transcriptions/${id}/autres/0`, {
      instance: 'rte-a',
      texte: 'Bonjour à vous.',
    });
    expect(r.json()).toEqual({ statut: 'en_cours' });
    const lue = await app.inject({ method: 'GET', url: `${base}/sessions/${id}` });
    expect(lue.json()).toMatchObject({
      statut: 'en_cours',
      transcript: 'Autres : Bonjour à vous.',
      morceaux: 2,
      transcrits: 1,
    });
    await app.inject({ method: 'POST', url: `${base}/sessions/${id}/fin` });
  });

  it('accepte un morceau m4a envoyé par l’appli Mac, hors navigateur', async () => {
    const id = await ouvrir();
    const r = await app.inject({
      method: 'PUT',
      url: `${base}/sessions/${id}/morceaux/autres/0`,
      headers: { 'content-type': 'audio/mp4', 'x-debut-ms': '0' },
      payload: son,
    });
    expect(r.statusCode).toBe(204);
    await app.inject({ method: 'POST', url: `${base}/sessions/${id}/fin` });
  });

  it('enregistre sans rendez-vous : l’OS en crée un, sans toucher à Google', async () => {
    const r = await app.inject({ method: 'POST', url: `${base}/sessions`, payload: {} });
    expect(r.statusCode).toBe(201);
    const { id } = r.json<{ id: string }>();
    const ligne = await t.owner.pool.query<{ event_id: string; titre: string; statut: string }>(
      `select r.event_id, r.titre, r.statut from enregistrements_visio e
         join rendez_vous r on r.id = e.rendez_vous_id where e.id = $1`,
      [id],
    );
    expect(ligne.rows[0]?.event_id.startsWith('os:')).toBe(true);
    expect(ligne.rows[0]?.titre).toMatch(/^Enregistrement du \d{2}\/\d{2}\/\d{4} à \d{2}h\d{2}$/);
    expect(ligne.rows[0]?.statut).toBe('rdv');
    await app.inject({ method: 'POST', url: `${base}/sessions/${id}/fin` });
  });

  it('liste les enregistrements récents de l’instance, du plus récent au plus ancien', async () => {
    const a1 = await ouvrir();
    await app.inject({ method: 'POST', url: `${base}/sessions/${a1}/fin` });
    const libre = (
      await app.inject({ method: 'POST', url: `${base}/sessions`, payload: {} })
    ).json<{ id: string }>().id;
    const r = await app.inject({ method: 'GET', url: `${base}/enregistrements` });
    const liste = r.json<{ id: string; rdvId: string; titre: string; statut: string }[]>();
    expect(liste[0]).toMatchObject({ id: libre, statut: 'en_cours' });
    expect(liste[0]?.rdvId.startsWith('os:')).toBe(true);
    expect(liste.map((e) => e.id)).toContain(a1);
    const autre = await app.inject({ method: 'GET', url: '/api/i/rte-b/visio/enregistrements' });
    expect(autre.json<{ id: string }[]>().map((e) => e.id)).not.toContain(libre);
    await app.inject({ method: 'POST', url: `${base}/sessions/${libre}/fin` });
  });

  describe('suppression et modification', () => {
    const libre = async () =>
      (await app.inject({ method: 'POST', url: `${base}/sessions`, payload: {} })).json<{
        id: string;
      }>().id;
    const supprimer = (id: string, slug = 'rte-a') =>
      app.inject({ method: 'DELETE', url: `/api/i/${slug}/visio/sessions/${id}` });
    const compte = async (sql: string, args: unknown[]) =>
      Number((await t.owner.pool.query<{ n: string }>(sql, args)).rows[0]?.n);

    it('supprime un enregistrement libre avec ses morceaux et son rendez-vous', async () => {
      const id = await libre();
      await envoyer(id, 'moi', 0);
      await app.inject({ method: 'POST', url: `${base}/sessions/${id}/fin` });
      const rdvId = (
        await t.owner.pool.query<{ rendez_vous_id: string }>(
          'select rendez_vous_id from enregistrements_visio where id = $1',
          [id],
        )
      ).rows[0]?.rendez_vous_id;
      expect((await supprimer(id)).statusCode).toBe(204);
      expect(await compte('select count(*) n from enregistrements_visio where id = $1', [id])).toBe(
        0,
      );
      expect(
        await compte('select count(*) n from morceaux_visio where enregistrement_id = $1', [id]),
      ).toBe(0);
      expect(await compte('select count(*) n from rendez_vous where id = $1', [rdvId])).toBe(0);
    });

    it('garde le rendez-vous de l’agenda quand on supprime son enregistrement', async () => {
      const id = await ouvrir();
      await app.inject({ method: 'POST', url: `${base}/sessions/${id}/fin` });
      expect((await supprimer(id)).statusCode).toBe(204);
      expect(
        await compte("select count(*) n from rendez_vous where event_id = 'os:rte-1'", []),
      ).toBe(1);
    });

    it('garde le rendez-vous libre qui a déjà un compte rendu', async () => {
      const id = await libre();
      await t.owner.pool.query(
        `update rendez_vous set compte_rendu = 'Compte rendu fictif'
           where id = (select rendez_vous_id from enregistrements_visio where id = $1)`,
        [id],
      );
      await app.inject({ method: 'POST', url: `${base}/sessions/${id}/fin` });
      expect((await supprimer(id)).statusCode).toBe(204);
      expect(
        await compte(
          "select count(*) n from rendez_vous where compte_rendu = 'Compte rendu fictif'",
          [],
        ),
      ).toBe(1);
    });

    it('ne supprime pas l’enregistrement d’une autre instance', async () => {
      const id = await libre();
      expect((await supprimer(id, 'rte-b')).statusCode).toBe(404);
      expect(await compte('select count(*) n from enregistrements_visio where id = $1', [id])).toBe(
        1,
      );
    });

    it('modifie le transcript et le résumé, et efface un résumé vidé', async () => {
      const id = await libre();
      await app.inject({ method: 'POST', url: `${base}/sessions/${id}/fin` });
      const r = await app.inject({
        method: 'PATCH',
        url: `${base}/sessions/${id}`,
        payload: { transcript: 'Moi : Texte corrigé.', resume: 'Résumé corrigé.' },
      });
      expect(r.json()).toMatchObject({
        transcript: 'Moi : Texte corrigé.',
        resume: 'Résumé corrigé.',
      });
      const vide = await app.inject({
        method: 'PATCH',
        url: `${base}/sessions/${id}`,
        payload: { resume: '  ' },
      });
      expect(vide.json()).toMatchObject({ transcript: 'Moi : Texte corrigé.', resume: null });
    });

    it('refuse une modification invalide ou d’une autre instance', async () => {
      const id = await libre();
      const trop = await app.inject({
        method: 'PATCH',
        url: `${base}/sessions/${id}`,
        payload: { resume: 'x'.repeat(10_001) },
      });
      expect(trop.statusCode).toBe(400);
      const autre = await app.inject({
        method: 'PATCH',
        url: `/api/i/rte-b/visio/sessions/${id}`,
        payload: { transcript: 'x' },
      });
      expect(autre.statusCode).toBe(404);
    });
  });

  describe('rattachement et transcript du rendez-vous', () => {
    const libre = async () =>
      (await app.inject({ method: 'POST', url: `${base}/sessions`, payload: {} })).json<{
        id: string;
      }>().id;
    const compte = async (sql: string, args: unknown[]) =>
      Number((await t.owner.pool.query<{ n: string }>(sql, args)).rows[0]?.n);
    const rdvDe = async (id: string) =>
      (
        await t.owner.pool.query<{ event_id: string }>(
          `select r.event_id from enregistrements_visio e
             join rendez_vous r on r.id = e.rendez_vous_id where e.id = $1`,
          [id],
        )
      ).rows[0]?.event_id;

    it('rattache l’enregistrement à un rendez-vous existant et supprime le libre resté vide', async () => {
      const id = await libre();
      const ancien = await rdvDe(id);
      await app.inject({ method: 'POST', url: `${base}/sessions/${id}/fin` });
      const r = await app.inject({
        method: 'PATCH',
        url: `${base}/sessions/${id}`,
        payload: { rdvId: 'os:rte-1' },
      });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ id, rdvId: 'os:rte-1' });
      expect(await rdvDe(id)).toBe('os:rte-1');
      expect(await compte('select count(*) n from rendez_vous where event_id = $1', [ancien])).toBe(
        0,
      );
    });

    const ligne = async (eventId: string) =>
      (
        await t.owner.pool.query<{ compte_rendu: string | null; transcript: string | null }>(
          'select compte_rendu, transcript from rendez_vous where event_id = $1',
          [eventId],
        )
      ).rows[0];
    const rattacher = (id: string, rdvId: string) =>
      app.inject({ method: 'PATCH', url: `${base}/sessions/${id}`, payload: { rdvId } });

    it('fusionne : le compte rendu et le transcript du rendez-vous libre passent dans la cible', async () => {
      await t.owner.pool.query(
        "update rendez_vous set compte_rendu = null, transcript = null where event_id = 'os:rte-1'",
      );
      const id = await libre();
      const ancien = await rdvDe(id);
      await t.owner.pool.query(
        "update rendez_vous set compte_rendu = 'Compte rendu fictif', transcript = 'Texte fictif' where event_id = $1",
        [ancien],
      );
      await app.inject({ method: 'POST', url: `${base}/sessions/${id}/fin` });
      expect((await rattacher(id, 'os:rte-1')).statusCode).toBe(200);
      expect(await ligne('os:rte-1')).toEqual({
        compte_rendu: 'Compte rendu fictif',
        transcript: 'Texte fictif',
      });
      expect(await compte('select count(*) n from rendez_vous where event_id = $1', [ancien])).toBe(
        0,
      );
    });

    it('garde le compte rendu déjà présent dans la cible et ne perd pas un texte différent', async () => {
      await t.owner.pool.query(
        "update rendez_vous set compte_rendu = 'Déjà là', transcript = null where event_id = 'os:rte-1'",
      );
      const id = await libre();
      const ancien = await rdvDe(id);
      await t.owner.pool.query(
        "update rendez_vous set compte_rendu = 'Autre texte fictif' where event_id = $1",
        [ancien],
      );
      await app.inject({ method: 'POST', url: `${base}/sessions/${id}/fin` });
      await rattacher(id, 'os:rte-1');
      expect((await ligne('os:rte-1'))?.compte_rendu).toBe('Déjà là');
      // Le texte différent reste dans le rendez-vous libre, qui n'est donc pas supprimé.
      expect((await ligne(ancien!))?.compte_rendu).toBe('Autre texte fictif');
    });

    it('supprime le rendez-vous libre quand son compte rendu est une copie de la cible', async () => {
      await t.owner.pool.query(
        "update rendez_vous set compte_rendu = 'Identique fictif' where event_id = 'os:rte-1'",
      );
      const id = await libre();
      const ancien = await rdvDe(id);
      await t.owner.pool.query(
        "update rendez_vous set compte_rendu = 'Identique fictif' where event_id = $1",
        [ancien],
      );
      await app.inject({ method: 'POST', url: `${base}/sessions/${id}/fin` });
      await rattacher(id, 'os:rte-1');
      expect(await compte('select count(*) n from rendez_vous where event_id = $1', [ancien])).toBe(
        0,
      );
      await t.owner.pool.query(
        "update rendez_vous set compte_rendu = null where event_id = 'os:rte-1'",
      );
    });

    it('range l’entrée d’Inbox du résumé dans celle du rendez-vous cible', async () => {
      const id = await libre();
      await app.inject({ method: 'POST', url: `${base}/sessions/${id}/fin` });
      await t.owner.pool.query(
        "update enregistrements_visio set resume = 'Résumé fictif', statut = 'transcrit' where id = $1",
        [id],
      );
      await t.owner.pool.query(
        `insert into sujets (instance_id, type, titre, origine, source, source_id)
         select instance_id, 'compte_rendu', 'Résumé de la visio', 'os', 'visio', id::text from enregistrements_visio where id = $1`,
        [id],
      );
      await t.owner.pool.query(
        `insert into sujets (instance_id, type, titre, origine, source, source_id)
         select instance_id, 'compte_rendu', 'Rédiger le compte rendu', 'agenda', 'routine', 'agenda:os:rte-1'
         from enregistrements_visio where id = $1`,
        [id],
      );
      await rattacher(id, 'os:rte-1');
      expect(
        await compte("select count(*) n from sujets where source = 'visio' and source_id = $1", [
          id,
        ]),
      ).toBe(0);
      expect(
        (
          await t.owner.pool.query<{ t: string }>(
            "select compte_rendu_prepare->>'texte' t from sujets where source_id = 'agenda:os:rte-1'",
          )
        ).rows[0]?.t,
      ).toBe('Résumé fictif');
    });

    it('refuse un rendez-vous inconnu et ne touche pas à la session', async () => {
      const id = await libre();
      const avant = await rdvDe(id);
      const r = await app.inject({
        method: 'PATCH',
        url: `${base}/sessions/${id}`,
        payload: { rdvId: 'os:absent' },
      });
      expect(r.statusCode).toBe(404);
      expect(await rdvDe(id)).toBe(avant);
    });

    it('ne rattache pas à un rendez-vous d’une autre instance', async () => {
      await fabrique(t).insere(b, 'rendez_vous', 'event_id, titre, statut', [
        'os:rte-b-1',
        'Autre instance',
        'rdv',
      ]);
      const id = await libre();
      const r = await app.inject({
        method: 'PATCH',
        url: `${base}/sessions/${id}`,
        payload: { rdvId: 'os:rte-b-1' },
      });
      expect(r.statusCode).toBe(404);
    });

    it('garde le transcript dans le rendez-vous, et le rend avec sa fiche', async () => {
      const id = await libre();
      await app.inject({ method: 'POST', url: `${base}/sessions/${id}/fin` });
      await app.inject({
        method: 'PATCH',
        url: `${base}/sessions/${id}`,
        payload: { transcript: 'Moi : Texte à garder.' },
      });
      const r = await app.inject({
        method: 'POST',
        url: `${base}/sessions/${id}/transcript-rdv`,
      });
      expect(r.statusCode).toBe(200);
      const ligne = await t.owner.pool.query<{ transcript: string; transcript_at: Date }>(
        `select r.transcript, r.transcript_at from enregistrements_visio e
           join rendez_vous r on r.id = e.rendez_vous_id where e.id = $1`,
        [id],
      );
      expect(ligne.rows[0]?.transcript).toBe('Moi : Texte à garder.');
      expect(ligne.rows[0]?.transcript_at).toBeInstanceOf(Date);
      // Un rendez-vous libre qui garde un transcript n'est plus supprimé avec son enregistrement.
      const ev = await rdvDe(id);
      await app.inject({ method: 'DELETE', url: `${base}/sessions/${id}` });
      expect(await compte('select count(*) n from rendez_vous where event_id = $1', [ev])).toBe(1);
    });

    it('refuse de garder un transcript vide ou d’une session inconnue', async () => {
      const id = await libre();
      const vide = await app.inject({
        method: 'POST',
        url: `${base}/sessions/${id}/transcript-rdv`,
      });
      expect(vide.statusCode).toBe(404);
      const inconnue = await app.inject({
        method: 'POST',
        url: `${base}/sessions/00000000-0000-4000-8000-000000000000/transcript-rdv`,
      });
      expect(inconnue.statusCode).toBe(404);
    });
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
