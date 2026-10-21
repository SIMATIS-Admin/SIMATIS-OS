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
  createDraft,
  evenements,
  freeBusy,
  historique,
  mimeBrut,
  sansSignature,
  sendMessage,
} from './google.js';
import { gmailConnector } from './index.js';
import { connectGoogle } from './oauth.js';

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
      body: typeof init.body === 'string' ? init.body : undefined,
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
    if (url.includes('/events?')) {
      // Two pages: the second one is only reached through nextPageToken.
      if (new URL(url).searchParams.get('pageToken') === 'p2') {
        return json({
          items: [
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
