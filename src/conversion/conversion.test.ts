import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { buildApp } from '../app.js';
import { configureConnexion } from '../connexions/service.js';
import { withInstance } from '../db/context.js';
import { seedDemoIfEmpty } from '../demo/seed.js';
import { getInstanceBySlug } from '../instances/service.js';
import { writeGoogleAppSecret, writeGoogleToken } from '../secrets.js';
import { getFiche } from '../crm/fiches.js';
import { transfererRendezVous } from '../crm/rdv-liens.js';
import { compterATrier, creerRendezVousOs, listerRendezVous } from './rdv.js';

type Row = Record<string, unknown>;

describe('Rendez-vous and Devis', () => {
  let t: TestApp;
  let app: FastifyInstance;
  let secretsDir: string;

  const send = async (
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    payload?: unknown,
  ) => {
    const res = await app.inject({ method, url, payload: payload as object });
    return { status: res.statusCode, body: res.json<Row & Row[]>() };
  };
  const oppOf = async (slug: string) => {
    const { rows } = await t.owner.pool.query<{ id: string; contact_id: string }>(
      "select o.id, o.contact_id from opportunites o join instances i on i.id = o.instance_id where i.slug = $1 and o.clos is null and o.etape in ('detection', 'prospection', 'qualification') and o.contact_id is not null order by o.titre limit 1",
      [slug],
    );
    if (!rows[0]) throw new Error('no open deal');
    return rows[0];
  };

  beforeAll(async () => {
    t = await setupTestApp();
    await seedDemoIfEmpty(t.owner.db);
    secretsDir = await mkdtemp(path.join(tmpdir(), 'simatis-conversion-'));
    app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test', secretsDir });
  });

  afterAll(async () => {
    await app.close();
    await t.drop();
    await rm(secretsDir, { recursive: true, force: true });
  });

  it('has no quotes outside SIMATIS’s own instance', async () => {
    expect((await send('GET', '/api/i/helioval/devis')).status).toBe(404);
    expect(
      (await send('POST', '/api/i/helioval/devis', { opportuniteId: crypto.randomUUID() })).status,
    ).toBe(404);
  });

  it('prepares a quote without prices, refuses to validate it until every price is set', async () => {
    const opp = await oppOf('simatis');
    const created = await send('POST', '/api/i/simatis/devis', { opportuniteId: opp.id });
    expect(created.status).toBe(200);
    const id = created.body.id as string;
    expect(created.body.lignes).toEqual([
      expect.objectContaining({ prixUnitaire: null }),
      expect.objectContaining({ prixUnitaire: null }),
    ]);

    const tooSoon = await send('POST', `/api/i/simatis/devis/${id}/valider`);
    expect(tooSoon.status).toBe(400);
    expect(tooSoon.body.error).toMatch(/prix/);

    const lignes = (created.body.lignes as Row[]).map((l, k) => ({
      ...l,
      prixUnitaire: k === 0 ? 4500 : null,
    }));
    await send('PATCH', `/api/i/simatis/devis/${id}`, { lignes });
    expect((await send('POST', `/api/i/simatis/devis/${id}/valider`)).status).toBe(400);

    lignes[1] = { ...lignes[1], prixUnitaire: 1500 };
    await send('PATCH', `/api/i/simatis/devis/${id}`, { lignes });
    expect((await send('POST', `/api/i/simatis/devis/${id}/valider`)).status).toBe(200);
    const list = await send('GET', '/api/i/simatis/devis');
    expect(list.body[0]).toMatchObject({ statut: 'valide', total: 6000, prixManquant: false });
    expect((await send('PATCH', `/api/i/simatis/devis/${id}`, { lignes })).status).toBe(400);
  });

  it('sends a quote only once the pilot validates the L2 proposal', async () => {
    const [devis] = (await send('GET', '/api/i/simatis/devis')).body;
    const proposal = await send('POST', `/api/i/simatis/devis/${devis?.id as string}/transmettre`);
    expect(proposal.body).toMatchObject({
      type: 'devis.transmettre',
      niveau: 'L2',
      statut: 'proposee',
    });
    expect((await send('GET', '/api/i/simatis/devis')).body[0]).toMatchObject({ statut: 'valide' });

    const decided = await send(
      'POST',
      `/api/i/simatis/propositions/${proposal.body.id as string}/decision`,
      {
        decision: 'valider',
      },
    );
    expect(decided.body).toMatchObject({ statut: 'appliquee' });
    expect((await send('GET', '/api/i/simatis/devis')).body[0]).toMatchObject({
      statut: 'transmis',
    });
    const { rows } = await t.owner.pool.query<{ etape: string }>(
      'select etape from opportunites where id = (select opportunite_id from devis limit 1)',
    );
    expect(rows[0]?.etape).toBe('proposition');
  });

  it('links agenda meetings to contacts and deals, and turns a compte rendu into a task proposal', async () => {
    const { rows } = await t.owner.pool.query<{ email: string; id: string }>(
      "select c.email, c.id from contacts c join instances i on i.id = c.instance_id join opportunites o on o.contact_id = c.id and o.clos is null where i.slug = 'helioval' limit 1",
    );
    const contact = rows[0];
    if (!contact) throw new Error('no contact');
    const instance = await getInstanceBySlug(t.app.db, 'helioval');
    if (!instance) throw new Error('no instance');
    await withInstance(t.app.db, instance.id, (tx) =>
      configureConnexion(tx, { kind: 'agenda', fournisseur: 'google-agenda', reglages: {} }),
    );
    await writeGoogleAppSecret(secretsDir, 'GOCSPX-fictif');
    await writeFile(path.join(secretsDir, 'helioval.google.json'), '{"refresh_token":"r"}');
    const fetch = (url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            url.includes('oauth2')
              ? { access_token: 'a' }
              : {
                  items: [
                    {
                      id: 'evt-1',
                      summary: 'Point projet',
                      start: { dateTime: '2026-10-12T08:00:00Z' },
                      end: { dateTime: '2026-10-12T09:00:00Z' },
                      attendees: [
                        { email: 'moi@example.fr', self: true },
                        { email: contact.email.toUpperCase() },
                      ],
                    },
                    {
                      id: 'evt-creneau',
                      summary: 'Bureau réservé',
                      start: { dateTime: '2026-10-12T07:00:00Z' },
                      end: { dateTime: '2026-10-12T15:00:00Z' },
                    },
                  ],
                },
          ),
        ),
      );
    const list = await listerRendezVous(
      t.app.db,
      instance,
      { secretsDir, realWrites: false },
      new Date('2026-10-09T08:00:00Z'),
      { fetch },
    );
    expect(list.etat).toBe('ok');
    // A slot of more than two hours is a booking, not a meeting to prepare.
    expect(list.rdv.map((r) => r.id)).toEqual(['evt-1']);
    expect(list.rdv[0]).toMatchObject({
      id: 'evt-1',
      contact: { id: contact.id },
      compteRendu: false,
    });
    expect(list.rdv[0]?.opportunite?.titre).toBeTruthy();

    const prep = await send(
      'GET',
      `/api/i/helioval/opportunites/${list.rdv[0]?.opportunite?.id as string}/preparation`,
    );
    expect(prep.status).toBe(200);
    expect(prep.body).toHaveProperty('aCreuser');

    const cr = await send('POST', '/api/i/helioval/rendez-vous/evt-1/compte-rendu', {
      titre: 'Point projet',
      texte: 'Besoin confirmé, proposition en deux options attendue.',
      contactId: contact.id,
      opportuniteId: list.rdv[0]?.opportunite?.id,
    });
    expect(cr.body).toMatchObject({ type: 'crm.tache', statut: 'proposee' });
    const again = await listerRendezVous(
      t.app.db,
      instance,
      { secretsDir, realWrites: false },
      new Date('2026-10-09T08:00:00Z'),
      { fetch },
    );
    expect(again.rdv[0]?.compteRendu).toBe(true);
    expect(
      (await send('POST', '/api/i/helioval/rendez-vous/evt-1/compte-rendu', { titre: 'x' })).status,
    ).toBe(400);

    // Linked by hand to a company: it wins over the guests' emails, until unlinked.
    const ent = await t.owner.pool.query<{ id: string; nom: string }>(
      "select e.id, e.nom from entreprises e join instances i on i.id = e.instance_id where i.slug = 'helioval' order by e.nom limit 1",
    );
    const entreprise = ent.rows[0];
    if (!entreprise) throw new Error('no company');
    const lien = (corps: unknown) => send('PUT', '/api/i/helioval/rendez-vous/evt-1/lien', corps);
    expect((await lien({ contactId: null, entrepriseId: entreprise.id })).status).toBe(200);
    const lister = () =>
      listerRendezVous(
        t.app.db,
        instance,
        { secretsDir, realWrites: false },
        new Date('2026-10-09T08:00:00Z'),
        { fetch },
      );
    expect((await lister()).rdv[0]).toMatchObject({
      contact: null,
      entreprise: { id: entreprise.id, nom: entreprise.nom },
      lienManuel: true,
    });
    // Linked by hand to the deal's contact: the open deal is still found for the preparation.
    expect((await lien({ contactId: contact.id, entrepriseId: null })).status).toBe(200);
    expect((await lister()).rdv[0]).toMatchObject({
      contact: { id: contact.id },
      lienManuel: true,
      opportunite: { id: list.rdv[0]?.opportunite?.id },
    });
    expect((await lien({ contactId: null, entrepriseId: null })).status).toBe(200);
    expect((await lister()).rdv[0]).toMatchObject({
      contact: { id: contact.id },
      lienManuel: false,
    });
    expect((await lien({ contactId: 'pas-un-uuid', entrepriseId: null })).status).toBe(400);
    expect(
      (await lien({ contactId: '00000000-0000-4000-8000-000000000000', entrepriseId: null }))
        .status,
    ).toBe(400);
  });

  it('sorts a meeting as a RDV or not, links it to several records and keeps its compte rendu', async () => {
    const instance = await getInstanceBySlug(t.app.db, 'helioval');
    if (!instance) throw new Error('no instance');
    const guest = await t.owner.pool.query<{ email: string; id: string }>(
      "select c.id, c.email from contacts c join instances i on i.id = c.instance_id where i.slug = 'helioval' and c.email is not null limit 1",
    );
    const guestEmail = guest.rows[0]?.email.toUpperCase() ?? '';
    const fetch = (url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            url.includes('oauth2')
              ? { access_token: 'a' }
              : {
                  items: [
                    {
                      id: 'evt-3',
                      summary: 'Point fictif',
                      start: { dateTime: '2026-10-13T12:00:00Z' },
                      end: { dateTime: '2026-10-13T13:00:00Z' },
                      attendees: [
                        { email: 'moi@example.fr', self: true },
                        { email: 'Inconnu.Fictif@example.test' },
                        { email: guestEmail },
                      ],
                    },
                  ],
                },
          ),
        ),
      );
    const lister = () =>
      listerRendezVous(
        t.app.db,
        instance,
        { secretsDir, realWrites: false },
        new Date('2026-10-09T08:00:00Z'),
        { fetch },
      );
    expect((await lister()).rdv[0]).toMatchObject({ id: 'evt-3', statut: 'a_trier' });
    expect(await compterATrier(t.app.db, instance, new Date('2026-10-09T08:00:00Z'))).toBe(1);

    // « Pas un RDV » sticks, even after the agenda is read again.
    expect(
      (await send('PATCH', '/api/i/helioval/rendez-vous/evt-3', { statut: 'ignore' })).status,
    ).toBe(200);
    expect((await lister()).rdv[0]).toMatchObject({ statut: 'ignore' });
    // The menu badge counts what is still to sort, and drops when a block is set aside.
    expect(await compterATrier(t.app.db, instance, new Date('2026-10-09T08:00:00Z'))).toBe(0);
    expect(typeof (await send('GET', '/api/i/helioval/rendez-vous/compteur')).body.n).toBe(
      'number',
    );
    expect(
      (await send('PATCH', '/api/i/helioval/rendez-vous/evt-3', { statut: 'nimporte' })).status,
    ).toBe(400);
    expect(
      (await send('PATCH', '/api/i/helioval/rendez-vous/evt-3', { statut: 'rdv' })).status,
    ).toBe(200);

    const { rows: ents } = await t.owner.pool.query<{ id: string; nom: string }>(
      "select e.id, e.nom from entreprises e join instances i on i.id = e.instance_id where i.slug = 'helioval' order by e.nom limit 2",
    );
    const [ent1, ent2] = ents;
    if (!ent1 || !ent2) throw new Error('no companies');
    const opp = await oppOf('helioval');
    const lien = (method: 'POST' | 'DELETE', kind: string, id: string) =>
      send(method, '/api/i/helioval/rendez-vous/evt-3/liens', { kind, id });
    expect((await lien('POST', 'entreprise', ent1.id)).status).toBe(200);
    expect((await lien('POST', 'entreprise', ent1.id)).status).toBe(200);
    expect((await lien('POST', 'affaire', opp.id)).status).toBe(200);
    expect((await lien('POST', 'contact', opp.contact_id)).status).toBe(200);
    expect((await lien('POST', 'affaire', crypto.randomUUID())).status).toBe(400);
    expect(
      (await send('POST', '/api/i/helioval/rendez-vous/evt-3/liens', { kind: 'x' })).status,
    ).toBe(400);
    const fiche = (await send('GET', '/api/i/helioval/rendez-vous/evt-3')).body;
    expect(fiche).toMatchObject({
      id: 'evt-3',
      titre: 'Point fictif',
      statut: 'rdv',
      compteRendu: null,
    });
    expect((fiche.entreprises as Row[]).map((e) => e.id)).toEqual([ent1.id]);
    expect((fiche.affaires as Row[]).map((a) => a.id)).toEqual([opp.id]);
    expect((fiche.contacts as Row[]).map((c) => c.id)).toEqual([opp.contact_id]);

    // The guests: the pilot is left out, a known one points to its contact, an unknown one to none.
    const invites = fiche.participants as {
      email: string;
      contact: { id: string } | null;
    }[];
    expect(invites.map((p) => [p.email, p.contact?.id ?? null])).toEqual([
      ['inconnu.fictif@example.test', null],
      [guestEmail.toLowerCase(), guest.rows[0]?.id],
    ]);

    // A secondary address of a contact recognises the guest too.
    await t.owner.pool.query(
      "insert into contact_emails (instance_id, contact_id, email) values ($1, $2, 'inconnu.fictif@example.test')",
      [instance.id, guest.rows[0]?.id],
    );
    const apres = (await send('GET', '/api/i/helioval/rendez-vous/evt-3')).body
      .participants as typeof invites;
    expect(apres.map((p) => p.contact?.id ?? null)).toEqual([guest.rows[0]?.id, guest.rows[0]?.id]);

    // The records show the meeting in their own card.
    const ficheEntreprise = await getFiche(t.app.db, instance, 'entreprise', ent1.id);
    expect(ficheEntreprise?.rendezVous.map((r) => r.id)).toEqual(['evt-3']);
    expect((await lien('DELETE', 'contact', opp.contact_id)).status).toBe(200);
    expect(
      ((await send('GET', '/api/i/helioval/rendez-vous/evt-3')).body.contacts as Row[]).length,
    ).toBe(0);

    // A merge moves the meetings of the absorbed company to the kept one.
    await withInstance(t.app.db, instance.id, (tx) =>
      transfererRendezVous(tx, 'entreprise', ent1.id, ent2.id),
    );
    expect(
      (await getFiche(t.app.db, instance, 'entreprise', ent2.id))?.rendezVous.map((r) => r.id),
    ).toEqual(['evt-3']);

    // The compte rendu belongs to the meeting, reaches the history of its records and is offered to
    // the second brain; the next-step task is optional.
    const cr = await send('POST', '/api/i/helioval/rendez-vous/evt-3/compte-rendu', {
      titre: 'Point fictif',
      texte: 'Décision : lancer la phase deux.',
      proposerTache: false,
    });
    expect(cr.body).toEqual({ ok: true });
    expect((await send('GET', '/api/i/helioval/rendez-vous/evt-3')).body.compteRendu).toMatchObject(
      {
        texte: 'Décision : lancer la phase deux.',
      },
    );
    const { rows: props } = await t.owner.pool.query<{ type: string }>(
      "select type from propositions where type = 'note.second_cerveau' and contenu->>'titre' = 'Compte rendu : Point fictif'",
    );
    expect(props).toHaveLength(1);
    const historique = (await getFiche(t.app.db, instance, 'entreprise', ent2.id))?.historique;
    expect(historique?.some((h) => h.type === 'compte_rendu')).toBe(true);
    expect((await lister()).rdv[0]).toMatchObject({ compteRendu: true, statut: 'rdv' });

    // Never listed, and no agenda to look into: not found.
    expect((await send('GET', '/api/i/aquaterra/rendez-vous/evt-absent')).status).toBe(404);
  });

  it('lists the calendars of the connected account, and none when the agenda is not connected', async () => {
    expect((await send('GET', '/api/i/aquaterra/agendas')).body).toEqual({
      etat: 'non_configure',
      agendas: [],
    });
  });

  it('leaves out an agenda that cannot be read, and keeps the meetings of the others', async () => {
    const instance = await getInstanceBySlug(t.app.db, 'helioval');
    if (!instance) throw new Error('no instance');
    await t.owner.pool.query(
      "update connexions set reglages = $1::jsonb where kind = 'agenda' and instance_id = $2",
      [JSON.stringify({ calendriers: ['primary', 'ancien@absent.example'] }), instance.id],
    );
    const fetch = (url: string) =>
      Promise.resolve(
        url.includes('oauth2')
          ? new Response(JSON.stringify({ access_token: 'a' }))
          : url.includes('ancien%40absent.example')
            ? new Response(JSON.stringify({ error: { message: 'Not Found' } }), { status: 404 })
            : new Response(
                JSON.stringify({
                  items: [
                    {
                      id: 'evt-2',
                      summary: 'Visio',
                      start: { dateTime: '2026-10-12T10:00:00Z' },
                      end: { dateTime: '2026-10-12T11:00:00Z' },
                    },
                  ],
                }),
              ),
      );
    const list = await listerRendezVous(
      t.app.db,
      instance,
      { secretsDir, realWrites: false },
      new Date('2026-10-09T08:00:00Z'),
      { fetch },
    );
    expect(list.etat).toBe('ok');
    expect(list.agendasIgnores).toEqual(['ancien@absent.example']);
    expect(list.rdv.map((r) => r.id)).toContain('evt-2');
  });

  it('reports an agenda that is not connected', async () => {
    expect((await send('GET', '/api/i/aquaterra/rendez-vous')).body).toMatchObject({
      etat: 'non_configure',
      rdv: [],
    });
  });

  describe('copy of an OS meeting into Google Agenda', () => {
    const saisie = { titre: 'Point fictif', debut: '2026-11-03T09:00:00.000Z', dureeMinutes: 45 };
    const fakeAgenda = () => {
      const posts: string[] = [];
      const fetch = (url: string, init: RequestInit) => {
        if (url.includes('oauth2')) return Promise.resolve(new Response('{"access_token":"a"}'));
        if (init.method === 'POST') {
          posts.push(init.body as string);
          return Promise.resolve(
            new Response('{"id":"ev-1","htmlLink":"https://example.test/ev"}'),
          );
        }
        return Promise.resolve(new Response('{}', { status: 404 }));
      };
      return { fetch, posts };
    };
    const reel = async () => {
      const instance = await getInstanceBySlug(t.app.db, 'simatis');
      if (!instance) throw new Error('no instance');
      return { ...instance, config: { ...instance.config, ecrituresReelles: true } };
    };

    it('keeps the meeting in the OS alone when Google is not connected or lacks the agenda scope', async () => {
      const instance = await reel();
      const google = fakeAgenda();
      await writeGoogleAppSecret(secretsDir, 'GOCSPX-fictif');
      await rm(path.join(secretsDir, 'simatis.google.json'), { force: true });
      const sans = await creerRendezVousOs(t.app.db, instance, saisie, {
        secretsDir,
        realWrites: true,
        fetch: google.fetch,
      });
      expect(sans).toMatchObject({ google: 'indisponible' });
      expect(sans.id.startsWith('os:')).toBe(true);

      await writeGoogleToken(secretsDir, 'simatis', { refresh_token: 'r', scope: 'gmail.compose' });
      expect(
        (
          await creerRendezVousOs(t.app.db, instance, saisie, {
            secretsDir,
            realWrites: true,
            fetch: google.fetch,
          })
        ).google,
      ).toBe('indisponible');
      expect(google.posts).toHaveLength(0);
    });

    it('writes nothing to Google while real writes are off, and a copy once both locks are on', async () => {
      const instance = await reel();
      const google = fakeAgenda();
      await writeGoogleToken(secretsDir, 'simatis', {
        refresh_token: 'r',
        scope: 'https://www.googleapis.com/auth/calendar.events',
      });
      const simule = await creerRendezVousOs(t.app.db, instance, saisie, {
        secretsDir,
        realWrites: false,
        fetch: google.fetch,
      });
      expect(simule.google).toBe('simulation');
      expect(google.posts).toHaveLength(0);

      const cree = await creerRendezVousOs(t.app.db, instance, saisie, {
        secretsDir,
        realWrites: true,
        fetch: google.fetch,
      });
      expect(cree.google).toBe('ok');
      expect(JSON.parse(google.posts[0] ?? '{}')).toMatchObject({
        summary: 'Point fictif',
        end: { dateTime: '2026-11-03T09:45:00.000Z' },
        extendedProperties: { private: { simatisOs: cree.id } },
      });
    });

    it('keeps the meeting when Google refuses the copy', async () => {
      const instance = await reel();
      const fetch = (url: string) =>
        Promise.resolve(
          url.includes('oauth2')
            ? new Response('{"access_token":"a"}')
            : new Response('{"error":{"message":"Forbidden"}}', { status: 403 }),
        );
      const refuse = await creerRendezVousOs(t.app.db, instance, saisie, {
        secretsDir,
        realWrites: true,
        fetch,
      });
      expect(refuse.google).toBe('erreur');
      const { rows } = await t.owner.pool.query('select 1 from rendez_vous where event_id = $1', [
        refuse.id,
      ]);
      expect(rows).toHaveLength(1);
    });
  });
});
