import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { connexions } from '../connexions/schema.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { actualiserLinkedin } from './linkedin.js';
import {
  demanderLectureLinkedin,
  lireLinkedin,
  LinkedinIndisponible,
  passageDu,
} from './linkedin-passages.js';
import { modifierRoutine } from '../routines/service.js';

describe('LinkedIn : passages du jour', () => {
  // October 2026 is on summer time: Paris = UTC + 2.
  it.each([
    ['2026-10-05T06:59:00Z', null], // 8h59 Monday
    ['2026-10-05T07:00:00Z', '2026-10-05@9'],
    ['2026-10-05T11:30:00Z', '2026-10-05@9'],
    ['2026-10-05T12:00:00Z', '2026-10-05@14'],
    ['2026-10-05T20:00:00Z', '2026-10-05@14'],
    ['2026-10-10T10:00:00Z', null], // Saturday
    ['2026-10-11T12:00:00Z', null], // Sunday
  ])('at %s the passage is %s', (instant, attendu) => {
    expect(passageDu(new Date(instant))).toBe(attendu);
  });
});

describe('LinkedIn : lecture du libellé', () => {
  let t: TestApp;
  let dir: string;
  let propre: Instance;
  let sansGmail: Instance;
  let mandat: Instance;

  const h = (name: string, value: string) => ({ name, value });
  const urls: string[] = [];
  // Fictive Google: one notification in the label.
  const fetch = (url: string) => {
    urls.push(url);
    const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body)));
    if (url.startsWith('https://oauth2.googleapis.com/token')) return json({ access_token: 'at' });
    if (url.includes('/messages?')) return json({ messages: [{ id: 'g1', threadId: 'gt1' }] });
    if (url.includes('/messages/g1')) {
      return json({
        snippet: 'Bonjour, je voulais vous proposer un échange',
        payload: {
          headers: [
            h('From', 'LinkedIn <messages-noreply@linkedin.com>'),
            h('Subject', 'Paul Fictif vous a envoyé un message'),
            h('Date', 'Mon, 5 Oct 2026 09:00:00 +0200'),
          ],
        },
      });
    }
    return Promise.reject(new Error(`inattendu : ${url}`));
  };

  const brancher = (instanceId: string, fournisseur: string) =>
    withInstance(t.app.db, instanceId, (tx) =>
      tx.insert(connexions).values({
        instanceId,
        kind: 'messagerie',
        fournisseur,
        etat: 'ok',
      }),
    );

  beforeAll(async () => {
    t = await setupTestApp();
    dir = await mkdtemp(path.join(tmpdir(), 'simatis-linkedin-'));
    propre = await createInstance(t.owner.db, { slug: 'lkp-propre', nom: 'P', type: 'propre' });
    sansGmail = await createInstance(t.owner.db, { slug: 'lkp-sans', nom: 'S', type: 'propre' });
    mandat = await createInstance(t.owner.db, { slug: 'lkp-mandat', nom: 'M', type: 'mandat' });
    await writeFile(
      path.join(dir, 'lkp-propre.env'),
      'GOOGLE_CLIENT_ID=c\nGOOGLE_CLIENT_SECRET=s\nGOOGLE_REFRESH_TOKEN=rt\n',
    );
    await brancher(propre.id, 'gmail');
    await brancher(sansGmail.id, 'infomaniak');
    await brancher(mandat.id, 'gmail');
  });

  afterAll(async () => {
    await t.drop();
    await rm(dir, { recursive: true, force: true });
  });

  it('files each notification of the label in the Inbox, once', async () => {
    expect(await lireLinkedin(t.app.db, propre, dir, { fetch })).toEqual({ lues: 1, nouveaux: 1 });
    expect(await lireLinkedin(t.app.db, propre, dir, { fetch })).toEqual({ lues: 1, nouveaux: 0 });
    const q = urls.find((u) => u.includes('/messages?')) ?? '';
    expect(decodeURIComponent(q.replace(/\+/g, ' '))).toContain(
      'label:messages-linkedin newer_than:14d',
    );
    const { rows } = await t.owner.pool.query<{ titre: string; origine: string }>(
      'select titre, origine from sujets where instance_id = $1',
      [propre.id],
    );
    expect(rows).toEqual([{ titre: 'Message LinkedIn de Paul Fictif', origine: 'linkedin' }]);
  });

  it('refuses a mailbox that is not Gmail and an instance that is not the pilot’s own', async () => {
    await expect(lireLinkedin(t.app.db, sansGmail, dir, { fetch })).rejects.toBeInstanceOf(
      LinkedinIndisponible,
    );
    await expect(lireLinkedin(t.app.db, mandat, dir, { fetch })).rejects.toBeInstanceOf(
      LinkedinIndisponible,
    );
  });
});

describe('LinkedIn : demande de lecture du texte', () => {
  let t: TestApp;
  let i: Instance;

  const deposer = (id: string) =>
    withInstance(t.app.db, i.id, (tx) =>
      actualiserLinkedin(tx, () =>
        Promise.resolve([
          {
            messageId: id,
            threadId: `t-${id}`,
            de: null,
            objet: 'Votre résumé de la semaine',
            date: null,
            extrait: 'Aperçu',
          },
        ]),
      ),
    );
  const executions = async () =>
    (
      await t.owner.pool.query<{ demande_par: string }>(
        "select demande_par from executions where instance_id = $1 and routine = 'linkedin'",
        [i.id],
      )
    ).rows;
  const regler = (change: Parameters<typeof modifierRoutine>[2]) =>
    withInstance(t.app.db, i.id, (tx) => modifierRoutine(tx, 'linkedin', change));

  beforeAll(async () => {
    t = await setupTestApp();
    i = await createInstance(t.owner.db, { slug: 'lkd-propre', nom: 'P', type: 'propre' });
  });

  afterAll(async () => {
    await t.drop();
  });

  it('asks for nothing when there is nothing to read', async () => {
    expect(await demanderLectureLinkedin(t.app.db, i)).toBe('rien');
  });

  it('asks for nothing while the routine is paused, which is how it is created', async () => {
    await deposer('x1');
    expect(await demanderLectureLinkedin(t.app.db, i)).toBe('refusee');
    expect(await executions()).toEqual([]);
  });

  it('asks once the pilot has turned the routine on, and not twice while a run is open', async () => {
    await regler({ actif: true });
    expect(await demanderLectureLinkedin(t.app.db, i)).toBe('demandee');
    expect(await executions()).toEqual([{ demande_par: 'planification' }]);
    expect(await demanderLectureLinkedin(t.app.db, i)).toBe('refusee');
  });

  it('asks for nothing when the routine is set to on demand only', async () => {
    await t.owner.pool.query(
      "update executions set statut = 'terminee' where instance_id = $1 and routine = 'linkedin'",
      [i.id],
    );
    await regler({ params: { declenchement: 'À la demande seulement' } });
    expect(await demanderLectureLinkedin(t.app.db, i)).toBe('refusee');
    expect(await executions()).toHaveLength(1);
  });
});
