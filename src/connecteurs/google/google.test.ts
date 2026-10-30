import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../../test/database.js';
import { runCommand } from '../../admin/cli.js';
import {
  configureConnexion,
  getConnector,
  registerConnector,
  syncConnexion,
} from '../../connexions/service.js';
import type { SyncCtx } from '../../connexions/types.js';
import { withInstance } from '../../db/context.js';
import type { Instance } from '../../instances/schema.js';
import { createInstance } from '../../instances/service.js';
import { loadInstanceSecrets } from '../../secrets.js';
import {
  agendasDisponibles,
  copierFichier,
  creerDossier,
  creerEvenement,
  createDraft,
  envoyerEnDoc,
  evenements,
  exporterDocx,
  freeBusy,
  historique,
  lireDoc,
  mimeBrut,
  modifierDoc,
  sansSignature,
  sendMessage,
} from './google.js';
import { gmailConnector } from './index.js';
import { connectGoogle, DRIVE_SCOPE, SCOPES, scopeAccorde } from './oauth.js';

type Call = { url: string; method: string; body: string | undefined };

// Fictive Google: OAuth token endpoint, Gmail drafts and messages, Calendar freeBusy.
function fakeGoogle() {
  const calls: Call[] = [];
  const json = (body: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));
  const fetch = (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      body: Buffer.isBuffer(init.body)
        ? init.body.toString('utf8')
        : (init.body as string | undefined),
    });
    if (url === 'https://oauth2.googleapis.com/token') {
      const params = new URLSearchParams(typeof init.body === 'string' ? init.body : '');
      if (params.get('grant_type') === 'authorization_code') {
        return json({ refresh_token: 'rt-fictif', scope: 'gmail.compose', access_token: 'at' });
      }
      return params.get('refresh_token') === 'rt-fictif'
        ? json({ access_token: 'at-fictif' })
        : json({ error: 'invalid_grant' }, 400);
    }
    const doc = (id: string, name: string) =>
      json({ id, name, webViewLink: `https://docs.google.com/document/d/${id}/edit` });
    if (url.includes('/upload/drive/v3/files')) return doc('doc-1', 'Rapport fictif v1');
    if (url.includes('/drive/v3/files/doc-1/copy')) return doc('doc-2', 'Rapport fictif v2');
    if (url.includes('/drive/v3/files/doc-1/export')) {
      return Promise.resolve(new Response(Buffer.from('PK-export-fictif')));
    }
    if (url.includes('/drive/v3/files?')) return doc('dossier-1', 'Diagnostic fictif');
    if (url === 'https://docs.googleapis.com/v1/documents/doc-1') {
      return json({
        title: 'Rapport fictif v1',
        body: {
          content: [
            { paragraph: { elements: [{ textRun: { content: 'Synthèse\n' } }] } },
            {
              table: {
                tableRows: [
                  {
                    tableCells: [
                      { content: [{ paragraph: { elements: [{ textRun: { content: 'A\n' } }] } }] },
                      { content: [{ paragraph: { elements: [{ textRun: { content: 'B\n' } }] } }] },
                    ],
                  },
                ],
              },
            },
          ],
        },
      });
    }
    if (url.endsWith(':batchUpdate')) return json({ documentId: 'doc-1' });
    if (url.endsWith('/drafts')) return json({ id: 'draft-42' });
    if (url.endsWith('/messages/send')) return json({ id: 'sent-7', labelIds: ['SENT'] });
    if (url.includes('/messages?')) return json({ messages: [{ id: 'm1' }] });
    if (url.includes('/messages/m1')) {
      return json({
        id: 'm1',
        snippet: 'Merci pour votre proposition',
        payload: {
          headers: [
            { name: 'Subject', value: 'Proposition' },
            { name: 'From', value: 'a.valliere@fonderie-valliere.example' },
          ],
        },
      });
    }
    if (url.includes('/users/me/calendarList')) {
      return json({
        items: [
          { id: 'marc@exemple.fr', summary: 'Marc', primary: true, accessRole: 'owner' },
          {
            id: 'kairos@group.calendar.google.com',
            summary: 'Kairos fictif',
            summaryOverride: 'KAIROS',
            accessRole: 'reader',
            backgroundColor: '#8e24aa',
          },
        ],
      });
    }
    if (url.endsWith('/freeBusy')) {
      return json({
        calendars: {
          primary: { busy: [{ start: '2026-10-12T07:30:00Z', end: '2026-10-12T08:30:00Z' }] },
        },
      });
    }
    if (url.includes('/calendars/primary/events') && init.method === 'POST') {
      return json({ id: 'ev-os-1', htmlLink: 'https://calendar.google.com/event?eid=ev-os-1' });
    }
    if (url.includes('/events?')) {
      // Two pages: the second one is only reached through nextPageToken.
      if (new URL(url).searchParams.get('pageToken') === 'p2') {
        return json({
          items: [
            // Written by the OS (it also lives in the OS under its os: id): not listed twice.
            {
              id: 'ev-os-1',
              summary: 'Copie du rendez-vous créé dans l’OS',
              extendedProperties: { private: { simatisOs: 'os:abc' } },
              start: { dateTime: '2026-10-12T09:00:00Z' },
              end: { dateTime: '2026-10-12T10:00:00Z' },
            },
            {
              id: 'e2',
              summary: 'Séminaire',
              start: { date: '2026-10-13' },
              end: { date: '2026-10-14' },
            },
          ],
        });
      }
      return json({
        nextPageToken: 'p2',
        items: [
          {
            id: 'e1',
            summary: 'Point client',
            colorId: '7',
            attendees: [
              { email: 'Moi@exemple.test', self: true },
              { email: 'Client@Exemple.test' },
            ],
            start: { dateTime: '2026-10-12T07:30:00Z' },
            end: { dateTime: '2026-10-12T08:30:00Z' },
          },
        ],
      });
    }
    return json({ error: { message: `route inconnue ${url}` } }, 404);
  };
  return { fetch, calls };
}

describe('Google OAuth (google:connect)', () => {
  it('receives the code on the local redirect, checks the state and returns the refresh token', async () => {
    const google = fakeGoogle();
    const token = await connectGoogle({
      clientId: 'client-fictif',
      clientSecret: 'secret-fictif',
      fetch: google.fetch,
      open: (url) => {
        const u = new URL(url);
        expect(u.searchParams.get('access_type')).toBe('offline');
        expect(u.searchParams.get('code_challenge_method')).toBe('S256');
        const redirect = new URL(u.searchParams.get('redirect_uri') ?? '');
        redirect.searchParams.set('code', 'code-fictif');
        redirect.searchParams.set('state', u.searchParams.get('state') ?? '');
        void fetch(redirect);
      },
    });
    expect(token.refresh_token).toBe('rt-fictif');
    const exchange = new URLSearchParams(google.calls[0]?.body);
    expect(exchange.get('code')).toBe('code-fictif');
    expect(exchange.get('code_verifier')).toBeTruthy();
  });

  it('refuses an answer whose state does not match', async () => {
    await expect(
      connectGoogle({
        clientId: 'c',
        clientSecret: 's',
        fetch: fakeGoogle().fetch,
        open: (url) => {
          const redirect = new URL(new URL(url).searchParams.get('redirect_uri') ?? '');
          redirect.searchParams.set('code', 'x');
          redirect.searchParams.set('state', 'autre');
          void fetch(redirect);
        },
      }),
    ).rejects.toThrow(/state/);
  });
});

describe('Gmail and Calendar', () => {
  let t: TestApp;
  let a: Instance;
  let secretsDir: string;
  let google: ReturnType<typeof fakeGoogle>;

  const ctx = async <T>(reel: boolean, fn: (c: SyncCtx) => Promise<T>) =>
    withInstance(t.app.db, a.id, async (tx) =>
      fn({
        instance: a,
        tx,
        secrets: await loadInstanceSecrets(secretsDir, a.slug),
        reglages: {},
        connexionId: '',
        derniereSynchro: null,
        reel,
      }),
    );

  beforeAll(async () => {
    t = await setupTestApp();
    a = await createInstance(t.owner.db, {
      slug: 'mandat-google',
      nom: 'Mandat Google',
      type: 'mandat',
    });
    secretsDir = await mkdtemp(path.join(tmpdir(), 'simatis-google-'));
    await writeFile(
      path.join(secretsDir, 'mandat-google.env'),
      'GOOGLE_CLIENT_ID=client-fictif\nGOOGLE_CLIENT_SECRET=secret-fictif\n',
    );
  });

  afterAll(async () => {
    await t.drop();
    await rm(secretsDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    google = fakeGoogle();
  });

  it('explains that google:connect is missing, and offers no messaging connection', async () => {
    await expect(
      ctx(true, (c) => createDraft(c, { to: 'x@y.example', subject: 's', html: 'h' }, google)),
    ).rejects.toThrow(/Connecter le compte Google/);
    expect(await withInstance(t.app.db, a.id, (tx) => getConnector(tx, 'messagerie'))).toBeNull();
  });

  it('connects through the CLI: token file (owner only) and both connections set up', async () => {
    const lines: string[] = [];
    const code = await runCommand(['google:connect', '--slug', 'mandat-google'], {
      db: t.owner.db,
      out: (l) => lines.push(l),
      secretsDir,
      connectGoogle: () => Promise.resolve({ refresh_token: 'rt-fictif', scope: 'gmail.compose' }),
    });
    expect(code, lines.join('\n')).toBe(0);
    const file = await stat(path.join(secretsDir, 'mandat-google.google.json'));
    expect(file.mode & 0o777).toBe(0o600);
    expect((await loadInstanceSecrets(secretsDir, 'mandat-google')).GOOGLE_REFRESH_TOKEN).toBe(
      'rt-fictif',
    );
    const { rows } = await t.owner.pool.query<{ kind: string; fournisseur: string; etat: string }>(
      'select kind, fournisseur, etat from connexions where instance_id = $1 order by kind',
      [a.id],
    );
    expect(rows).toEqual([
      { kind: 'agenda', fournisseur: 'google-agenda', etat: 'ok' },
      { kind: 'messagerie', fournisseur: 'gmail', etat: 'ok' },
    ]);
  });

  it('sends the invitation directly, and nothing at all in simulation', async () => {
    const message = {
      to: 'jeanne@exemple.test',
      subject: 'Votre test VMA : Atelier',
      html: '<p>Lien</p>',
    };
    const simulated = await ctx(false, (c) => sendMessage(c, message, google));
    expect(simulated).toEqual({ simulation: true });
    expect(google.calls.filter((c) => c.url.endsWith('/messages/send'))).toHaveLength(0);

    const envoye = await ctx(true, (c) => sendMessage(c, message, google));
    expect(envoye).toEqual({ simulation: false });
    const appel = google.calls.find((c) => c.url.endsWith('/messages/send'));
    expect(appel?.method).toBe('POST');
    const corps = JSON.parse(appel?.body ?? '{}') as { raw?: unknown };
    expect(typeof corps.raw).toBe('string');
  });

  it('knows whether the stored token has the Drive scope', async () => {
    const secrets = await loadInstanceSecrets(secretsDir, 'mandat-google');
    // The fictive token above was granted before Drive existed: the screen must ask to reconnect.
    expect(secrets.GOOGLE_SCOPE).toBe('gmail.compose');
    expect(scopeAccorde(secrets.GOOGLE_SCOPE, DRIVE_SCOPE)).toBe(false);
    expect(scopeAccorde(SCOPES.join(' '), DRIVE_SCOPE)).toBe(true);
    expect(scopeAccorde(undefined, DRIVE_SCOPE)).toBe(false);
  });

  it('asks exactly the scopes declared for Google verification', () => {
    expect(SCOPES).toEqual([
      'https://www.googleapis.com/auth/gmail.compose',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/drive.file',
    ]);
  });

  it('creates the folder and the Google Doc, and nothing at all in simulation', async () => {
    const simuleDossier = await ctx(false, (c) =>
      creerDossier(c, 'Diagnostic fictif', undefined, google),
    );
    expect(simuleDossier).toEqual({ fichier: null, simulation: true });
    const simuleDoc = await ctx(false, (c) =>
      envoyerEnDoc(c, { nom: 'Rapport fictif v1', docx: Buffer.from('PK') }, google),
    );
    expect(simuleDoc).toEqual({ fichier: null, simulation: true });
    expect(google.calls.filter((c) => c.url.includes('/drive/'))).toHaveLength(0);

    const dossier = await ctx(true, (c) => creerDossier(c, 'Diagnostic fictif', undefined, google));
    expect(dossier.fichier?.id).toBe('dossier-1');
    const dossierCall = google.calls.find((c) => c.url.includes('/drive/v3/files?'));
    expect(JSON.parse(dossierCall?.body ?? '{}')).toMatchObject({
      name: 'Diagnostic fictif',
      mimeType: 'application/vnd.google-apps.folder',
    });

    const cree = await ctx(true, (c) =>
      envoyerEnDoc(
        c,
        { nom: 'Rapport fictif v1', docx: Buffer.from('PK-docx-fictif'), dossierId: 'dossier-1' },
        google,
      ),
    );
    expect(cree.fichier).toEqual({
      id: 'doc-1',
      nom: 'Rapport fictif v1',
      lien: 'https://docs.google.com/document/d/doc-1/edit',
    });
    const upload = google.calls.find((c) => c.url.includes('/upload/drive/v3/files'));
    expect(upload?.url).toContain('uploadType=multipart');
    // Metadata asks for a Google Doc inside the folder; the Word bytes follow.
    expect(upload?.body).toContain('"mimeType":"application/vnd.google-apps.document"');
    expect(upload?.body).toContain('"parents":["dossier-1"]');
    expect(upload?.body).toContain('PK-docx-fictif');
  });

  it('copies a Doc as a new version, exports it as Word and reads its text', async () => {
    expect(await ctx(false, (c) => copierFichier(c, 'doc-1', 'Rapport fictif v2', google))).toEqual(
      {
        fichier: null,
        simulation: true,
      },
    );
    const copie = await ctx(true, (c) => copierFichier(c, 'doc-1', 'Rapport fictif v2', google));
    expect(copie.fichier?.id).toBe('doc-2');

    const docx = await ctx(true, (c) => exporterDocx(c, 'doc-1', google));
    expect(docx.toString()).toBe('PK-export-fictif');
    expect(google.calls.find((c) => c.url.includes('/export'))?.url).toContain(
      'mimeType=application%2Fvnd.openxmlformats',
    );

    const lu = await ctx(true, (c) => lireDoc(c, 'doc-1', google));
    expect(lu).toEqual({ titre: 'Rapport fictif v1', texte: 'Synthèse\nA\tB' });
  });

  it('edits the Doc in place, and not at all in simulation', async () => {
    const requests = [
      { replaceAllText: { containsText: { text: 'ancien' }, replaceText: 'nouveau' } },
    ];
    expect(await ctx(false, (c) => modifierDoc(c, 'doc-1', requests, google))).toEqual({
      simulation: true,
    });
    expect(google.calls.filter((c) => c.url.endsWith(':batchUpdate'))).toHaveLength(0);

    expect(await ctx(true, (c) => modifierDoc(c, 'doc-1', requests, google))).toEqual({
      simulation: false,
    });
    const appel = google.calls.find((c) => c.url.endsWith(':batchUpdate'));
    expect(JSON.parse(appel?.body ?? '{}')).toEqual({ requests });
  });

  it('creates a draft without signature, and nothing at all in simulation', async () => {
    const simulated = await ctx(false, (c) =>
      createDraft(c, { to: 'a@b.example', subject: 'Relance', html: '<p>Bonjour</p>' }, google),
    );
    expect(simulated).toEqual({ draftId: null, simulation: true });
    expect(google.calls).toHaveLength(0);

    const created = await ctx(true, (c) =>
      createDraft(
        c,
        {
          to: 'a.valliere@fonderie-valliere.example',
          subject: 'Votre proposition, créneaux possibles',
          html: '<p>Bonjour Agathe,</p><p>Trois créneaux.</p><p>-- </p><p>Marc, SIMATIS</p>',
        },
        google,
      ),
    );
    expect(created).toEqual({ draftId: 'draft-42', simulation: false });
    const draft = google.calls.find((c) => c.url.endsWith('/drafts'));
    const raw = Buffer.from(
      (JSON.parse(draft?.body ?? '{}') as { message: { raw: string } }).message.raw,
      'base64url',
    ).toString();
    const html = Buffer.from(raw.split('\r\n\r\n')[1] ?? '', 'base64').toString();
    expect(html).toContain('Trois créneaux.');
    expect(html).not.toContain('--');
    expect(html).not.toContain('Marc, SIMATIS');
    expect(raw).toContain('Subject: =?UTF-8?B?');
  });

  it('sans image, le message reste exactement celui d’avant (une seule partie HTML)', () => {
    const brut = mimeBrut({ to: 'a@b.example', subject: 'Relance', html: '<p>Bonjour</p>' });
    expect(brut).toContain('Content-Type: text/html; charset="UTF-8"');
    expect(brut).not.toMatch(/multipart|Content-ID/);
  });

  it('avec une signature en image, assemble un message multipart/related avec le cid', () => {
    const image = {
      cid: 'signature',
      typeMime: 'image/png',
      base64: Buffer.alloc(200, 7).toString('base64'),
    };
    const brut = mimeBrut({
      to: 'a@b.example',
      subject: 'Relance',
      html: '<p>Bonjour</p><p><img src="cid:signature"></p>',
      images: [image],
    });
    const frontiere = /Content-Type: multipart\/related; boundary="([^"]+)"/.exec(brut)?.[1];
    expect(frontiere).toBeTruthy();
    const parties = brut.split(`--${frontiere}`);
    // en-têtes, partie HTML, partie image, fermeture
    expect(parties).toHaveLength(4);
    expect(parties[1]).toContain('Content-Type: text/html; charset="UTF-8"');
    expect(parties[2]).toContain('Content-Type: image/png');
    expect(parties[2]).toContain('Content-ID: <signature>');
    expect(parties[2]).toContain('Content-Disposition: inline');
    const lignes = (parties[2] ?? '').split('\r\n').filter((l) => /^[A-Za-z0-9+/=]{20,}$/.test(l));
    expect(lignes.every((l) => l.length <= 76)).toBe(true);
    expect(Buffer.from(lignes.join(''), 'base64').equals(Buffer.alloc(200, 7))).toBe(true);
    expect(parties[3]?.trim()).toBe('--');
  });

  it('refuse une image dont le type, le cid ou le contenu n’est pas sûr', () => {
    const faire = (i: { cid: string; typeMime: string; base64: string }) => () =>
      mimeBrut({ to: 'a@b.example', subject: 's', html: 'h', images: [i] });
    expect(faire({ cid: 'sig', typeMime: 'text/html', base64: 'AAAA' })).toThrow();
    expect(faire({ cid: 'sig>\r\nBcc: x', typeMime: 'image/png', base64: 'AAAA' })).toThrow();
    expect(faire({ cid: 'sig', typeMime: 'image/png', base64: '<script>' })).toThrow();
  });

  it('crée le brouillon dans le fil Gmail quand un threadId est donné, et seulement alors', async () => {
    await ctx(true, (c) =>
      createDraft(
        c,
        { to: 'a@b.example', subject: 'Re: Échange', html: '<p>x</p>', threadId: 'thread-9' },
        google,
      ),
    );
    await ctx(true, (c) =>
      createDraft(c, { to: 'a@b.example', subject: 'Nouveau', html: '<p>x</p>' }, google),
    );
    const bodies = google.calls
      .filter((c) => c.url.endsWith('/drafts'))
      .map((c) => (JSON.parse(c.body ?? '{}') as { message: Record<string, unknown> }).message);
    expect(bodies.at(-2)?.threadId).toBe('thread-9');
    expect(bodies.at(-1)).not.toHaveProperty('threadId');
  });

  it('l’opération draft.create transmet images et fil à Gmail', async () => {
    const image = { cid: 'signature', typeMime: 'image/png', base64: 'AAAA' };
    await ctx(true, (c) =>
      gmailConnector(google).write!(c, {
        op: 'draft.create',
        data: {
          to: 'a@b.example',
          subject: 'Re: x',
          html: '<p>x</p>',
          images: [image],
          threadId: 't1',
        },
      }),
    );
    const draft = google.calls.filter((c) => c.url.endsWith('/drafts')).at(-1);
    const message = (
      JSON.parse(draft?.body ?? '{}') as { message: { raw: string; threadId: string } }
    ).message;
    expect(message.threadId).toBe('t1');
    expect(Buffer.from(message.raw, 'base64url').toString()).toContain('Content-ID: <signature>');
  });

  it('envoie dans le fil Gmail avec la signature en image, et reste inchangé sans fil ni image', async () => {
    const image = { cid: 'signature', typeMime: 'image/png', base64: 'AAAA' };
    await ctx(true, (c) =>
      sendMessage(
        c,
        {
          to: 'a@b.example',
          subject: 'Re: x',
          html: '<p>x</p>',
          images: [image],
          threadId: 'fil-1',
        },
        google,
      ),
    );
    await ctx(true, (c) =>
      sendMessage(c, { to: 'a@b.example', subject: 'Simple', html: '<p>x</p>' }, google),
    );
    const envois = google.calls
      .filter((c) => c.url.endsWith('/messages/send'))
      .map((c) => JSON.parse(c.body ?? '{}') as { raw: string; threadId?: string });
    const [avec, sans] = envois.slice(-2);
    expect(avec?.threadId).toBe('fil-1');
    expect(Buffer.from(avec?.raw ?? '', 'base64url').toString()).toContain(
      'Content-ID: <signature>',
    );
    expect(sans).not.toHaveProperty('threadId');
    expect(Buffer.from(sans?.raw ?? '', 'base64url').toString()).not.toContain('multipart');
  });

  it('l’opération message.send transmet images et fil, et rien ne part en simulation', async () => {
    const data = {
      to: 'a@b.example',
      subject: 'Re: y',
      html: '<p>y</p>',
      images: [{ cid: 'signature', typeMime: 'image/png', base64: 'AAAA' }],
      threadId: 't9',
    };
    const avant = google.calls.length;
    const simule = await ctx(false, (c) =>
      gmailConnector(google).write!(c, { op: 'message.send', data }),
    );
    expect(simule).toEqual({ simulation: true });
    expect(google.calls).toHaveLength(avant);
    await ctx(true, (c) => gmailConnector(google).write!(c, { op: 'message.send', data }));
    const envoi = google.calls.filter((c) => c.url.endsWith('/messages/send')).at(-1);
    expect((JSON.parse(envoi?.body ?? '{}') as { threadId: string }).threadId).toBe('t9');
  });

  it('strips a signature block in any usual form', () => {
    expect(sansSignature('Bonjour\n-- \nMarc')).toBe('Bonjour');
    expect(sansSignature('<p>Bonjour</p><br>--<br>Marc')).toBe('<p>Bonjour</p>');
    expect(sansSignature('<p>Prix : 10--20 €</p>')).toBe('<p>Prix : 10--20 €</p>');
  });

  it('keeps a line break in the address or the subject from adding a header', () => {
    const brut = mimeBrut({
      to: 'paul@client.example\r\nBcc: autre@ailleurs.example',
      subject: 'Devis\r\nBcc: autre@ailleurs.example',
      html: '<p>Bonjour</p>',
    });
    const entetes = brut.split('\r\n\r\n')[0]?.split('\r\n') ?? [];
    expect(entetes.filter((l) => /^bcc:/i.test(l))).toEqual([]);
    expect(entetes).toHaveLength(5);
  });

  it('reads recent exchanges as snippets, and busy periods', async () => {
    const messages = await ctx(true, (c) =>
      historique(c, 'a.valliere@fonderie-valliere.example', { mois: 12 }, google),
    );
    expect(messages).toEqual([
      expect.objectContaining({
        id: 'm1',
        objet: 'Proposition',
        extrait: 'Merci pour votre proposition',
      }),
    ]);
    expect(messages[0]).not.toHaveProperty('corps');
    const busy = await ctx(true, (c) =>
      freeBusy(
        c,
        new Date('2026-10-12T00:00:00Z'),
        new Date('2026-10-13T00:00:00Z'),
        ['primary'],
        google,
      ),
    );
    expect(busy).toEqual([
      { debut: new Date('2026-10-12T07:30:00Z'), fin: new Date('2026-10-12T08:30:00Z') },
    ]);
  });

  it('reads every page of meetings, flags all-day events and keeps their Google colour', async () => {
    const liste = await ctx(true, (c) =>
      evenements(
        c,
        new Date('2026-10-12T00:00:00Z'),
        new Date('2026-10-14T00:00:00Z'),
        ['primary'],
        google,
      ),
    );
    expect(liste).toEqual([
      expect.objectContaining({
        id: 'e1',
        journee: false,
        participants: ['client@exemple.test'],
        agenda: 'primary',
        couleur: '#039be5',
      }),
      expect.objectContaining({ id: 'e2', titre: 'Séminaire', journee: true, couleur: null }),
    ]);
    expect(google.calls.filter((c) => c.url.includes('/events?'))).toHaveLength(2);
  });

  it('creates a meeting in the agenda, tagged with its OS id, and nothing at all in simulation', async () => {
    const google = fakeGoogle();
    const rdv = {
      osId: 'os:abc',
      titre: 'Point fictif',
      debut: new Date('2026-10-20T08:00:00Z'),
      fin: new Date('2026-10-20T09:00:00Z'),
      lieu: 'Annecy',
    };
    expect(await ctx(false, (c) => creerEvenement(c, rdv, google))).toEqual({
      evenement: null,
      simulation: true,
    });
    expect(google.calls.filter((c) => c.url.includes('/calendars/'))).toHaveLength(0);

    const cree = await ctx(true, (c) => creerEvenement(c, rdv, google));
    expect(cree).toEqual({
      evenement: { id: 'ev-os-1', lien: 'https://calendar.google.com/event?eid=ev-os-1' },
      simulation: false,
    });
    const appel = google.calls.find((c) => c.url.includes('/calendars/primary/events'));
    expect(appel?.method).toBe('POST');
    expect(JSON.parse(appel?.body ?? '{}')).toMatchObject({
      summary: 'Point fictif',
      location: 'Annecy',
      start: { dateTime: '2026-10-20T08:00:00.000Z' },
      end: { dateTime: '2026-10-20T09:00:00.000Z' },
      extendedProperties: { private: { simatisOs: 'os:abc' } },
    });
  });

  it('lists every calendar the Google account can see, shared or subscribed ones included', async () => {
    const google = fakeGoogle();
    const agendas = await ctx(true, (c) => agendasDisponibles(c, google));
    expect(agendas.map((a) => [a.nom, a.principal, a.role])).toEqual([
      ['Marc', true, 'owner'],
      ['KAIROS', false, 'reader'],
    ]);
    expect(agendas[1]?.id).toBe('kairos@group.calendar.google.com');
  });

  it('checks the authorization on sync, and reports a revoked one on the connection', async () => {
    registerConnector(gmailConnector({ fetch: google.fetch }));
    await expect(
      syncConnexion(t.app.db, a, 'messagerie', { secretsDir, realWrites: false }),
    ).resolves.toMatchObject({ lus: 0 });

    await writeFile(
      path.join(secretsDir, 'mandat-google.google.json'),
      JSON.stringify({ refresh_token: 'revoque' }),
    );
    await expect(
      syncConnexion(t.app.db, a, 'messagerie', { secretsDir, realWrites: false }),
    ).rejects.toThrow(/invalid_grant/);
    const { rows } = await t.owner.pool.query<{ etat: string }>(
      "select etat from connexions where instance_id = $1 and kind = 'messagerie'",
      [a.id],
    );
    expect(rows[0]?.etat).toBe('erreur');
  });

  it('never borrows the messaging connection of another instance', async () => {
    const b = await createInstance(t.owner.db, { slug: 'autre', nom: 'Autre', type: 'mandat' });
    await withInstance(t.app.db, a.id, (tx) =>
      configureConnexion(tx, { kind: 'messagerie', fournisseur: 'gmail', reglages: {} }),
    );
    expect(await withInstance(t.app.db, b.id, (tx) => getConnector(tx, 'messagerie'))).toBeNull();
  });
});
