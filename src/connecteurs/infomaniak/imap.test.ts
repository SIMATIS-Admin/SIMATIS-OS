import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../../test/database.js';
import { BOITE, startImap, type TestImap } from '../../../test/imap.js';
import { buildApp } from '../../app.js';
import { brancherGoogle } from '../../connexions/brancher.js';
import { getConnector } from '../../connexions/service.js';
import type { SyncCtx } from '../../connexions/types.js';
import { withInstance } from '../../db/context.js';
import type { Instance } from '../../instances/schema.js';
import { createInstance } from '../../instances/service.js';
import { loadInstanceSecrets } from '../../secrets.js';
import { messagerieDe } from '../messagerie.js';
import { infomaniakConnector } from './index.js';

const JOUR = 864e5;
const ilYA = (jours: number) => new Date(Date.now() - jours * JOUR);

const message = (o: {
  de: string;
  a: string;
  objet: string;
  id: string;
  date: Date;
  enReponseA?: string;
  type?: string;
  entetes?: string[];
  corps: string;
}) =>
  [
    `From: ${o.de}`,
    `To: ${o.a}`,
    `Subject: ${o.objet}`,
    `Message-ID: ${o.id}`,
    `Date: ${o.date.toUTCString().replace('GMT', '+0000')}`,
    ...(o.enReponseA ? [`In-Reply-To: ${o.enReponseA}`, `References: ${o.enReponseA}`] : []),
    ...(o.entetes ?? []),
    'MIME-Version: 1.0',
    `Content-Type: ${o.type ?? 'text/plain'}; charset="UTF-8"`,
    '',
    o.corps,
  ].join('\n');

describe('Infomaniak mailbox over IMAP', () => {
  let imap: TestImap;
  let t: TestApp;
  let app: FastifyInstance;
  let a: Instance;
  let secretsDir: string;
  let secrets: Record<string, string>;

  const boite = () => messagerieDe('infomaniak', { instance: a, secrets });
  const ctx = async <T>(reel: boolean, fn: (c: SyncCtx) => Promise<T>) =>
    withInstance(t.app.db, a.id, async (tx) =>
      fn({
        instance: a,
        tx,
        secrets,
        reglages: {},
        connexionId: '',
        derniereSynchro: null,
        reel,
      }),
    );
  const brancher = (body: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/api/i/mandat-imap/connexions/infomaniak', body });

  const apercu = () =>
    app.inject({ method: 'POST', url: '/api/i/mandat-imap/connexions/messagerie/apercu' });

  beforeAll(async () => {
    imap = await startImap();
    t = await setupTestApp();
    a = await createInstance(t.owner.db, {
      slug: 'mandat-imap',
      nom: 'Mandat IMAP',
      type: 'mandat',
    });
    secretsDir = await mkdtemp(path.join(tmpdir(), 'simatis-imap-'));
    app = buildApp({
      pool: t.app.pool,
      db: t.app.db,
      version: 'test',
      secretsDir,
      imapServeur: imap.serveur,
    });
    secrets = {
      IMAP_USER: BOITE.user,
      IMAP_PASSWORD: BOITE.password,
      IMAP_HOST: imap.serveur.host,
      IMAP_PORT: String(imap.serveur.port),
      IMAP_SECURE: 'non',
    };

    const paul = 'Paul Client <paul@client.example>';
    await imap.deposer(
      'INBOX',
      message({
        de: paul,
        a: BOITE.user,
        objet: 'Demande de devis',
        id: '<m1@client.example>',
        date: ilYA(5),
        corps: "Bonjour,\npouvez-vous m'envoyer   un devis ?",
      }),
      ilYA(5),
    );
    await imap.deposer(
      'Sent',
      message({
        de: BOITE.user,
        a: paul,
        objet: 'Re: Demande de devis',
        id: '<m2@pilote.example>',
        date: ilYA(4),
        enReponseA: '<m1@client.example>',
        corps: 'Bonjour Paul, le devis part demain.',
      }),
      ilYA(4),
    );
    await imap.deposer(
      'INBOX',
      message({
        de: 'lea@autre.example',
        a: BOITE.user,
        objet: 'Question',
        id: '<m3@autre.example>',
        date: ilYA(3),
        type: 'text/html',
        corps:
          '<html><style>p{color:red}</style><p>Bonjour&nbsp;Marc, avez-vous <b>une minute</b> ?</p></html>',
      }),
      ilYA(3),
    );
    await imap.deposer(
      'INBOX',
      message({
        de: 'infos@lettre.example',
        a: BOITE.user,
        objet: 'Lettre mensuelle',
        id: '<m6@lettre.example>',
        date: ilYA(2),
        entetes: ['List-Unsubscribe: <mailto:stop@lettre.example>', 'Precedence: bulk'],
        corps: 'Les nouveautés du mois.',
      }),
      ilYA(2),
    );
    await imap.deposer(
      'INBOX',
      message({
        de: paul,
        a: BOITE.user,
        objet: 'Vieux message',
        id: '<m4@client.example>',
        date: ilYA(500),
        corps: 'Ancien échange.',
      }),
      ilYA(500),
    );
    await imap.deposer(
      'Drafts',
      message({
        de: BOITE.user,
        a: paul,
        objet: 'Relance en attente',
        id: '<m5@pilote.example>',
        date: ilYA(10),
        corps: 'À finir.',
      }),
      ilYA(10),
      ['\\Draft'],
    );
  }, 180_000);

  afterAll(async () => {
    await app.close();
    await t.drop();
    await imap.stop();
    await rm(secretsDir, { recursive: true, force: true });
  });

  it('reads the recent exchanges with a contact, received and sent, newest first', async () => {
    const lus = await boite().historique('paul@client.example', { mois: 12 });
    expect(lus.map((m) => m.objet)).toEqual(['Re: Demande de devis', 'Demande de devis']);
    expect(lus[1]).toMatchObject({
      id: '<m1@client.example>',
      de: 'Paul Client <paul@client.example>',
      a: BOITE.user,
      extrait: "Bonjour, pouvez-vous m'envoyer un devis ?",
    });
    expect(lus[1]?.corps).toBeUndefined();
    expect(new Date(lus[0]?.date ?? '').getTime()).toBeGreaterThan(ilYA(5).getTime());
  });

  it('gives full bodies only when the instance reads them, and a longer history on demand', async () => {
    const complets = await boite().historique('paul@client.example', { mois: 24, complet: true });
    expect(complets.map((m) => m.objet)).toContain('Vieux message');
    expect(complets[0]?.corps).toContain('le devis part demain');
  });

  it('groups the inbox into threads reduced to their last message, sent replies included', async () => {
    const fils = await boite().filsRecents(14);
    expect(fils).toHaveLength(3);
    // A newsletter is flagged, not hidden: the Inbox rules decide.
    expect(fils[0]).toMatchObject({ threadId: '<m6@lettre.example>', automatique: true });
    expect(fils[1]).toMatchObject({
      threadId: '<m3@autre.example>',
      de: 'lea@autre.example',
      objet: 'Question',
      extrait: 'Bonjour Marc, avez-vous une minute ?',
      a: [BOITE.user.toLowerCase()],
      automatique: false,
    });
    // The pilot answered Paul: the thread's last message is his own.
    expect(fils[2]).toMatchObject({ threadId: '<m1@client.example>', de: BOITE.user });
    expect(await boite().compte()).toBe(BOITE.user);
  });

  it('lists the drafts waiting in the mailbox', async () => {
    const [b, ...autres] = await boite().brouillons();
    expect(autres).toEqual([]);
    expect(b).toMatchObject({
      objet: 'Relance en attente',
      a: 'Paul Client <paul@client.example>',
    });
    expect(new Date(b?.date ?? '').getTime()).toBeLessThan(ilYA(9).getTime());
  });

  it('explains a refused password and an unreachable server', async () => {
    const autre = (s: Record<string, string>) =>
      messagerieDe('infomaniak', { instance: a, secrets: { ...secrets, ...s } }).brouillons();
    await expect(autre({ IMAP_PASSWORD: 'faux' })).rejects.toThrow(/refuse cette adresse/);
    await expect(autre({ IMAP_PORT: '1' })).rejects.toThrow(/injoignable/);
    await expect(
      messagerieDe('infomaniak', { instance: a, secrets: {} }).brouillons(),
    ).rejects.toThrow(/Paramètres > Connexions/);
  });

  it('simulates the draft while real writes are off, then creates it, never sends it', async () => {
    const draft = {
      to: 'paul@client.example',
      subject: 'Votre devis — été',
      html: '<p>Bonjour Paul</p><br>--<br>Marc',
    };
    const write = (reel: boolean) =>
      ctx(reel, async (c) => {
        const result = await infomaniakConnector().write?.(c, { op: 'draft.create', data: draft });
        if (!result) throw new Error('no write');
        return result;
      });

    expect(await write(false)).toEqual({ simulation: true });
    expect(await imap.lire('Drafts')).toHaveLength(1);

    const cree = await write(true);
    expect(cree.simulation).toBe(false);
    const brouillons = await imap.lire('Drafts');
    expect(brouillons).toHaveLength(2);
    const dernier = brouillons.at(-1);
    expect(dernier?.flags).toContain('\\Draft');
    expect(dernier?.source).toContain(`From: ${BOITE.user}`);
    expect(dernier?.source).toContain('To: paul@client.example');
    const corps = Buffer.from(dernier?.source.split('\r\n\r\n')[1] ?? '', 'base64').toString();
    expect(corps).toBe('<p>Bonjour Paul</p>');
    expect(await imap.lire('Sent')).toHaveLength(1);
    expect((await boite().brouillons()).map((b) => b.objet)).toContain('Votre devis — été');
  });

  it('refuses a wrong address or password from Paramètres without saving anything', async () => {
    expect((await brancher({ email: 'pas-une-adresse', motDePasse: 'x' })).statusCode).toBe(400);
    const refuse = await brancher({ email: BOITE.user, motDePasse: 'faux' });
    expect(refuse.statusCode).toBe(400);
    expect(refuse.json<{ error: string }>().error).toMatch(/refuse cette adresse/);
    expect(await loadInstanceSecrets(secretsDir, 'mandat-imap')).not.toHaveProperty('IMAP_USER');
    expect(await withInstance(t.app.db, a.id, (tx) => getConnector(tx, 'messagerie'))).toBeNull();
    expect((await apercu()).statusCode).toBe(400);
  });

  it('connects the mailbox from Paramètres: secret kept on disk, never sent back', async () => {
    const ok = await brancher({
      email: ` ${BOITE.user.toUpperCase()} `,
      motDePasse: BOITE.password,
    });
    expect(ok.statusCode, ok.body).toBe(200);
    const file = path.join(secretsDir, 'mandat-imap.imap.json');
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ user: BOITE.user });

    const res = await app.inject({ method: 'GET', url: '/api/i/mandat-imap/connexions' });
    expect(res.body).not.toContain(BOITE.password);
    expect(res.json<{ connexions: unknown[] }>().connexions).toEqual([
      expect.objectContaining({
        kind: 'messagerie',
        fournisseur: 'infomaniak',
        etat: 'ok',
        reglages: { frequence: 'manuel', historiqueMois: 12, contenu: 'extraits' },
        secret: { nom: 'IMAP_PASSWORD', present: true },
      }),
    ]);
    const sync = await app.inject({
      method: 'POST',
      url: '/api/i/mandat-imap/connexions/messagerie/sync',
    });
    expect(sync.statusCode, sync.body).toBe(200);
  });

  it('shows the pilot what the OS reads in the mailbox, on demand', async () => {
    const res = await apercu();
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      compte: BOITE.user,
      jours: 14,
      fils: 3,
      brouillons: 2,
      derniers: [
        { de: 'infos@lettre.example', objet: 'Lettre mensuelle' },
        { de: 'lea@autre.example', objet: 'Question' },
        { de: BOITE.user, objet: 'Re: Demande de devis' },
      ],
    });
    expect(res.body).not.toContain('avez-vous');
  });

  it('keeps the Infomaniak mailbox when a Google account brings the agenda', async () => {
    await withInstance(t.app.db, a.id, brancherGoogle);
    const res = await app.inject({ method: 'GET', url: '/api/i/mandat-imap/connexions' });
    const parKind = Object.fromEntries(
      res
        .json<{ connexions: { kind: string; fournisseur: string }[] }>()
        .connexions.map((c) => [c.kind, c.fournisseur]),
    );
    expect(parKind).toEqual({ messagerie: 'infomaniak', agenda: 'google-agenda' });
  });
});
