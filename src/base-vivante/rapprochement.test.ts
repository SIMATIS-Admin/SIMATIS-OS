import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { configureConnexion } from '../connexions/service.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { analyser, estReponseAuto, estRetourEnErreur, type MessageBoite } from './boite-mail.js';
import { integrerFiches } from './integration.js';
import { normaliserFiche, type Brut } from './nettoyage.js';
import {
  etatRapprochement,
  lancerRapprochement,
  RapprochementImpossible,
  rapprocherBoite,
} from './rapprochement.js';
import { registerBaseVivanteRoutes } from './routes.js';
import { baseReponses } from './schema.js';
import { listerFiches } from './service.js';

const msg = (m: Partial<MessageBoite> & { id: string }): MessageBoite => ({
  labels: [],
  de: null,
  a: null,
  cc: null,
  objet: null,
  date: new Date('2026-09-10T10:00:00Z'),
  extrait: '',
  autoSubmitted: null,
  autoreply: null,
  failedRecipients: null,
  precedence: null,
  ...m,
});

describe('analyse d’une boîte mail', () => {
  const emails = new Set(['lea@atelier.test', 'paul@bureau.test']);
  const sansCorps = () => Promise.resolve('');

  it('compte les envois, les réponses et le dernier échange par adresse connue', async () => {
    const r = await analyser(
      [
        msg({ id: '1', labels: ['SENT'], a: 'Léa <lea@atelier.test>, hors@base.test' }),
        msg({ id: '2', labels: ['SENT'], a: 'lea@atelier.test', date: new Date('2026-09-20') }),
        msg({ id: '3', de: 'Léa Martin <LEA@atelier.test>', date: new Date('2026-09-25') }),
        msg({ id: '4', de: 'inconnu@ailleurs.test' }),
      ],
      emails,
      'marc@mandat.test',
      sansCorps,
    );
    expect([...r.keys()]).toEqual(['lea@atelier.test']);
    expect(r.get('lea@atelier.test')).toMatchObject({
      envoyes: 2,
      recus: 1,
      dernierEnvoi: new Date('2026-09-20'),
      dernierRecu: new Date('2026-09-25'),
      bounce: false,
    });
  });

  it('reconnaît un message envoyé à l’adresse du compte, sans label', async () => {
    const r = await analyser(
      [msg({ id: '1', de: 'marc@mandat.test', a: 'paul@bureau.test' })],
      emails,
      'marc@mandat.test',
      sansCorps,
    );
    expect(r.get('paul@bureau.test')?.envoyes).toBe(1);
  });

  it('lit l’adresse en erreur dans l’en-tête, sinon dans le corps du rapport', async () => {
    const r = await analyser(
      [
        msg({
          id: '1',
          de: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>',
          objet: 'Delivery Status Notification (Failure)',
          failedRecipients: 'lea@atelier.test',
        }),
        msg({
          id: '2',
          de: 'postmaster@bureau.test',
          objet: 'Undeliverable: Proposition',
        }),
      ],
      emails,
      'marc@mandat.test',
      () =>
        Promise.resolve("Votre message n'a pas pu être remis à paul@bureau.test (boîte pleine)"),
    );
    expect(r.get('lea@atelier.test')?.bounce).toBe(true);
    expect(r.get('paul@bureau.test')?.bounce).toBe(true);
  });

  it('distingue une réponse automatique d’une vraie réponse', () => {
    expect(estReponseAuto(msg({ id: '1', autoSubmitted: 'auto-replied' }))).toBe(true);
    expect(estReponseAuto(msg({ id: '2', objet: 'Réponse automatique : absence' }))).toBe(true);
    expect(estReponseAuto(msg({ id: '3', autoSubmitted: 'no', objet: 'Re: Proposition' }))).toBe(
      false,
    );
    expect(estRetourEnErreur(msg({ id: '4', de: 'MAILER-DAEMON@x.test' }))).toBe(true);
    expect(estRetourEnErreur(msg({ id: '5', de: 'lea@atelier.test', objet: 'Re: Salon' }))).toBe(
      false,
    );
  });
});

type Courrier = {
  id: string;
  labels?: string[];
  headers: Record<string, string>;
  snippet?: string;
  corps?: string;
};

describe('rapprochement avec la boîte Gmail d’un mandat', () => {
  let t: TestApp;
  let base: Instance;
  let mandat: Instance;
  let sansBoite: Instance;
  let secretsDir: string;
  let courriers: Courrier[];
  let appels: string[];

  const fetchGoogle = ((url: string) => {
    appels.push(url);
    const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body)));
    if (url === 'https://oauth2.googleapis.com/token') return json({ access_token: 'at-fictif' });
    if (url.endsWith('/profile')) return json({ emailAddress: 'marc@mandat.test' });
    if (url.includes('/messages?')) return json({ messages: courriers.map((c) => ({ id: c.id })) });
    const courrier = courriers.find((c) => url.includes(`/messages/${c.id}?`));
    if (!courrier) return Promise.resolve(new Response('{}', { status: 404 }));
    return json({
      id: courrier.id,
      labelIds: courrier.labels ?? [],
      snippet: courrier.snippet ?? '',
      payload: {
        headers: Object.entries(courrier.headers).map(([name, value]) => ({ name, value })),
        ...(url.includes('format=full') && courrier.corps
          ? {
              parts: [
                {
                  mimeType: 'text/plain',
                  body: { data: Buffer.from(courrier.corps).toString('base64url') },
                },
              ],
            }
          : {}),
      },
    });
  }) as unknown as typeof globalThis.fetch;

  beforeAll(async () => {
    t = await setupTestApp();
    secretsDir = await mkdtemp(path.join(tmpdir(), 'bv-secrets-'));
    base = await createInstance(t.owner.db, { slug: 'bv-r-base', nom: 'Base', type: 'propre' });
    mandat = await createInstance(t.owner.db, {
      slug: 'bv-r-mandat',
      nom: 'Mandat Fictif',
      type: 'mandat',
    });
    sansBoite = await createInstance(t.owner.db, {
      slug: 'bv-r-sans',
      nom: 'Sans boîte',
      type: 'mandat',
    });
    await withInstance(t.owner.db, mandat.id, (tx) =>
      configureConnexion(tx, { kind: 'messagerie', fournisseur: 'gmail' }),
    );
    await writeFile(
      path.join(secretsDir, 'bv-r-mandat.env'),
      'GOOGLE_CLIENT_ID=id-fictif\nGOOGLE_CLIENT_SECRET=secret-fictif\n',
    );
    await writeFile(
      path.join(secretsDir, 'bv-r-mandat.google.json'),
      JSON.stringify({ refresh_token: 'rt-fictif' }),
    );
  });
  afterAll(async () => {
    await t.drop();
    await rm(secretsDir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    for (const table of ['base_reponses', 'base_vivante'])
      await t.owner.pool.query(`delete from ${table}`);
    appels = [];
    courriers = [
      {
        id: 'm1',
        labels: ['SENT'],
        headers: {
          From: 'marc@mandat.test',
          To: 'lea@atelier.test',
          Date: 'Wed, 10 Sep 2026 10:00:00 +0000',
          Subject: 'Proposition',
        },
      },
      {
        id: 'm2',
        headers: {
          From: 'Léa <lea@atelier.test>',
          To: 'marc@mandat.test',
          Date: 'Fri, 12 Sep 2026 09:00:00 +0000',
          Subject: 'Re: Proposition',
        },
        snippet: 'Merci, pas pour le moment.',
      },
      {
        id: 'm3',
        labels: ['SENT'],
        headers: {
          From: 'marc@mandat.test',
          To: 'paul@bureau.test',
          Date: 'Thu, 11 Sep 2026 10:00:00 +0000',
          Subject: 'Proposition',
        },
      },
      {
        id: 'm4',
        headers: {
          From: 'paul@bureau.test',
          To: 'marc@mandat.test',
          'Auto-Submitted': 'auto-replied',
          Date: 'Thu, 11 Sep 2026 10:01:00 +0000',
          Subject: 'Réponse automatique : absent',
        },
      },
      {
        id: 'm5',
        labels: ['SENT'],
        headers: {
          From: 'marc@mandat.test',
          To: 'zoe@cabinet.test',
          Date: 'Thu, 11 Sep 2026 11:00:00 +0000',
          Subject: 'Proposition',
        },
      },
      {
        id: 'm6',
        headers: {
          From: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>',
          To: 'marc@mandat.test',
          'X-Failed-Recipients': 'zoe@cabinet.test',
          Date: 'Thu, 11 Sep 2026 11:01:00 +0000',
          Subject: 'Delivery Status Notification (Failure)',
        },
      },
      {
        id: 'm7',
        labels: ['SENT'],
        headers: {
          From: 'marc@mandat.test',
          To: 'yann@defaut.test',
          Date: 'Thu, 11 Sep 2026 12:00:00 +0000',
          Subject: 'Proposition',
        },
      },
      {
        id: 'm8',
        headers: {
          From: 'postmaster@defaut.test',
          To: 'marc@mandat.test',
          Date: 'Thu, 11 Sep 2026 12:01:00 +0000',
          Subject: 'Undeliverable: Proposition',
        },
        corps: "Le message n'a pas pu être remis à yann@defaut.test",
      },
      {
        id: 'm9',
        labels: ['SENT'],
        headers: {
          From: 'marc@mandat.test',
          To: 'hors@base.test',
          Date: 'Thu, 11 Sep 2026 13:00:00 +0000',
          Subject: 'Autre',
        },
      },
    ];
    await withInstance(t.app.db, base.id, (tx) =>
      integrerFiches(
        tx,
        base.id,
        (
          [
            {
              entreprise: 'Atelier Fictif',
              prenom: 'Léa',
              nom: 'Martin',
              email: 'lea@atelier.test',
            },
            {
              entreprise: 'Bureau Fictif',
              prenom: 'Paul',
              nom: 'Petit',
              email: 'paul@bureau.test',
            },
            {
              entreprise: 'Cabinet Fictif',
              prenom: 'Zoé',
              nom: 'Neuve',
              email: 'zoe@cabinet.test',
            },
            {
              entreprise: 'Défaut Fictif',
              prenom: 'Yann',
              nom: 'Gris',
              email: 'yann@defaut.test',
              telephone: '0612345678',
            },
            { entreprise: 'Jamais Fictif', prenom: 'Eve', nom: 'Vierge', email: 'eve@jamais.test' },
          ] as Brut[]
        ).map((b) => ({
          fiche: normaliserFiche(b).fiche,
          provenance: 'Sharp',
          mandat: null,
          importId: null,
          collecteLe: null,
        })),
      ),
    );
  });

  const rapprocher = () =>
    rapprocherBoite(
      t.app.db,
      { secretsDir, fetch: fetchGoogle },
      base,
      mandat,
      new Date('2026-09-01'),
    );
  const fiches = async () => (await listerFiches(t.app.db, base.id, { limite: 50 })).fiches;

  it('met à jour les fiches : contactés, réponses, réponses automatiques, adresses en erreur', async () => {
    expect(await rapprocher()).toEqual({
      messages: 9,
      contactes: 4,
      reponses: 1,
      autos: 1,
      bounces: 2,
      jamaisContactes: 1,
    });
    const parNom = Object.fromEntries((await fiches()).map((f) => [f.nom, f]));
    expect(parNom.MARTIN).toMatchObject({
      resultat: 'repondu',
      statutProspection: 'a_repondu',
      mandatContacteur: 'Mandat Fictif',
      dernierContactCanal: 'email',
      nbContacts: 1,
    });
    expect(parNom.MARTIN?.dernierContactLe?.toISOString()).toBe('2026-09-12T09:00:00.000Z');
    expect(parNom.PETIT).toMatchObject({ resultat: 'reponse_auto', statutProspection: 'contacte' });
    // Bounces: no more email, so « à enrichir » unless there is a phone number.
    expect(parNom.NEUVE).toMatchObject({
      emailInvalide: true,
      zone: 'a_enrichir',
      resultat: 'sans_reponse',
    });
    expect(parNom.GRIS).toMatchObject({ emailInvalide: true, zone: 'prospectable' });
    expect(parNom.VIERGE).toMatchObject({
      statutProspection: 'jamais_contacte',
      dernierContactLe: null,
    });
  });

  it('garde les réponses à classer, et classe d’office les réponses automatiques', async () => {
    await rapprocher();
    const reponses = await t.owner.db.select().from(baseReponses);
    expect(reponses.map((r) => [r.messageId, r.auto, r.classe, r.validee]).sort()).toEqual([
      ['m2', false, null, false],
      ['m4', true, 'reponse_auto', true],
    ]);
    expect(reponses.find((r) => r.messageId === 'm2')).toMatchObject({
      extrait: 'Merci, pas pour le moment.',
      mandat: 'Mandat Fictif',
    });
  });

  it('relancé, il ne duplique rien et garde un résultat déjà classé', async () => {
    await rapprocher();
    await t.owner.pool.query("update base_vivante set resultat = 'interesse' where nom = 'MARTIN'");
    await rapprocher();
    expect(await t.owner.db.select().from(baseReponses)).toHaveLength(2);
    expect((await fiches()).find((f) => f.nom === 'MARTIN')?.resultat).toBe('interesse');
  });

  it('ne lit que les en-têtes, sauf le corps d’un rapport d’erreur sans adresse', async () => {
    await rapprocher();
    const complets = appels.filter((u) => u.includes('format=full'));
    expect(complets).toHaveLength(1);
    expect(complets[0]).toContain('/messages/m8?');
    expect(appels.every((u) => !u.includes('/send') && !u.includes('/modify'))).toBe(true);
  });

  it('refuse un mandat sans boîte Gmail connectée', async () => {
    await expect(
      rapprocherBoite(t.app.db, { secretsDir, fetch: fetchGoogle }, base, sansBoite, new Date()),
    ).rejects.toThrow(RapprochementImpossible);
  });

  it('tourne en tâche de fond avec un état consultable', async () => {
    const debut = lancerRapprochement(
      t.app.db,
      { secretsDir, fetch: fetchGoogle },
      base,
      mandat,
      new Date('2026-09-01'),
    );
    expect(debut.etat).toBe('en_cours');
    expect(() =>
      lancerRapprochement(t.app.db, { secretsDir, fetch: fetchGoogle }, base, mandat, new Date()),
    ).toThrow(RapprochementImpossible);
    for (let i = 0; i < 100 && etatRapprochement(base.id)?.etat === 'en_cours'; i++)
      await new Promise((r) => setTimeout(r, 50));
    expect(etatRapprochement(base.id)).toMatchObject({
      etat: 'termine',
      mandat: 'Mandat Fictif',
      depuis: '2026-09-01',
      lus: 9,
      total: 9,
      rapport: { contactes: 4 },
    });
  });

  describe('API', () => {
    const app = () => {
      const a = Fastify();
      registerBaseVivanteRoutes(a, { db: t.app.db, secretsDir, googleFetch: fetchGoogle });
      return a;
    };

    it('liste les mandats et enregistre la date de début', async () => {
      const a = app();
      const put = await a.inject({
        method: 'PUT',
        url: '/api/i/bv-r-base/base/mandats/bv-r-mandat',
        payload: { debut: '2026-09-01' },
      });
      expect(put.statusCode).toBe(200);
      const liste = await a.inject({ method: 'GET', url: '/api/i/bv-r-base/base/mandats' });
      expect(liste.json<{ slug: string; debutMandat: string | null }[]>()).toEqual(
        expect.arrayContaining([
          { slug: 'bv-r-mandat', nom: 'Mandat Fictif', debutMandat: '2026-09-01' },
        ]),
      );
      const refus = await a.inject({
        method: 'PUT',
        url: '/api/i/bv-r-base/base/mandats/bv-r-base',
        payload: { debut: '2026-09-01' },
      });
      expect(refus.statusCode).toBe(400);
      expect(
        (
          await a.inject({
            method: 'PUT',
            url: '/api/i/bv-r-base/base/mandats/bv-r-mandat',
            payload: { debut: 'hier' },
          })
        ).statusCode,
      ).toBe(400);
    });

    it('lance la lecture de la boîte à partir du début du mandat, puis donne le rapport', async () => {
      const a = app();
      await a.inject({
        method: 'PUT',
        url: '/api/i/bv-r-base/base/mandats/bv-r-mandat',
        payload: { debut: '2026-09-01' },
      });
      const lancement = await a.inject({
        method: 'POST',
        url: '/api/i/bv-r-base/base/rapprochement-mail',
        payload: { mandat: 'bv-r-mandat' },
      });
      expect(lancement.statusCode).toBe(202);
      expect(lancement.json<{ depuis: string }>().depuis).toBe('2026-09-01');
      for (let i = 0; i < 100; i++) {
        const etat = await a.inject({
          method: 'GET',
          url: '/api/i/bv-r-base/base/rapprochement-mail',
        });
        if (etat.json<{ etat: string }>().etat !== 'en_cours') break;
        await new Promise((r) => setTimeout(r, 50));
      }
      const fin = await a.inject({
        method: 'GET',
        url: '/api/i/bv-r-base/base/rapprochement-mail',
      });
      expect(fin.json<{ etat: string; rapport: { contactes: number } }>()).toMatchObject({
        etat: 'termine',
        rapport: { contactes: 4 },
      });
    });

    it('refuse un mandat sans date de début, sans boîte, ou inconnu', async () => {
      const a = app();
      const post = (payload: object) =>
        a.inject({ method: 'POST', url: '/api/i/bv-r-base/base/rapprochement-mail', payload });
      const sansDate = await post({ mandat: 'bv-r-sans' });
      expect(sansDate.statusCode).toBe(400);
      expect(sansDate.json<{ error: string }>().error).toMatch(/date de début/);
      const sansGmail = await post({ mandat: 'bv-r-sans', depuis: '2026-09-01' });
      expect(sansGmail.statusCode).toBe(400);
      expect(sansGmail.json<{ error: string }>().error).toMatch(/pas connectée/);
      expect((await post({ mandat: 'inconnu', depuis: '2026-09-01' })).statusCode).toBe(400);
    });
  });
});
