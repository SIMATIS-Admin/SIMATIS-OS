import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import type { NotificationMail } from '../connecteurs/google/google.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import {
  actualiserLinkedin,
  compterMessagesALire,
  enregistrerMessage,
  apercuPropre,
  expediteurLinkedin,
  LECTURES_MAX,
  messagesALire,
} from './linkedin.js';

const notif = (id: string, objet: string, extra: Partial<NotificationMail> = {}) => ({
  messageId: id,
  threadId: `t-${id}`,
  de: 'LinkedIn <messages-noreply@linkedin.com>',
  objet,
  date: 'Mon, 5 Oct 2026 09:00:00 +0200',
  extrait: 'Bonjour, pouvons-nous échanger cette semaine ?',
  ...extra,
});

describe('LinkedIn : aperçu', () => {
  it('removes the invisible padding of the notification preview', () => {
    expect(apercuPropre('1 nouveau message attend votre réponse \u034f \u034f \u034f  ')).toBe(
      '1 nouveau message attend votre réponse',
    );
  });
});

describe('LinkedIn : nom de l’expéditeur', () => {
  it.each([
    ['Paul Fictif vous a envoyé un message', 'Paul Fictif'],
    ['Paul Fictif vous a envoyé 3 nouveaux messages', 'Paul Fictif'],
    ['Nouveau message de Paul Fictif', 'Paul Fictif'],
    ['Vous avez un nouveau message de Paul Fictif', 'Paul Fictif'],
    ['Paul Fictif sent you a message', 'Paul Fictif'],
    ['New message from Paul Fictif', 'Paul Fictif'],
  ])('reads « %s »', (objet, attendu) => {
    expect(expediteurLinkedin(objet)).toBe(attendu);
  });

  it('gives nothing when the subject does not say who wrote', () => {
    expect(expediteurLinkedin('Votre résumé de la semaine')).toBeNull();
    expect(expediteurLinkedin(null)).toBeNull();
  });
});

describe('LinkedIn : dépôt dans l’Inbox', () => {
  let t: TestApp;
  let simatis: Instance;
  let autre: Instance;

  beforeAll(async () => {
    t = await setupTestApp();
    simatis = await createInstance(t.owner.db, { slug: 'lk-simatis', nom: 'S', type: 'propre' });
    autre = await createInstance(t.owner.db, { slug: 'lk-autre', nom: 'A', type: 'mandat' });
  });

  afterAll(async () => {
    await t.drop();
  });

  const sujetsDe = async (instanceId: string) =>
    (
      await t.owner.pool.query<{
        titre: string;
        resume: string | null;
        origine: string;
        type: string;
        lien: string | null;
        source: string;
        source_id: string;
      }>(
        'select titre, resume, origine, type, lien, source, source_id from sujets where instance_id = $1 order by source_id',
        [instanceId],
      )
    ).rows;

  it('turns each notification into an Inbox entry, once', async () => {
    const lire = () =>
      Promise.resolve([
        notif('m1', 'Paul Fictif vous a envoyé un message'),
        notif('m2', 'Votre résumé de la semaine', { extrait: 'Des nouvelles de votre réseau' }),
      ]);
    const un = await withInstance(t.app.db, simatis.id, (tx) => actualiserLinkedin(tx, lire));
    expect(un).toEqual({ lues: 2, nouveaux: 2 });
    const deux = await withInstance(t.app.db, simatis.id, (tx) => actualiserLinkedin(tx, lire));
    expect(deux).toEqual({ lues: 2, nouveaux: 0 });

    const [m1, m2] = await sujetsDe(simatis.id);
    expect(m1).toMatchObject({
      titre: 'Message LinkedIn de Paul Fictif',
      resume: 'Bonjour, pouvons-nous échanger cette semaine ?',
      origine: 'linkedin',
      type: 'mail_a_repondre',
      lien: 'https://www.linkedin.com/messaging/',
      source: 'linkedin',
      source_id: 'm1',
    });
    expect(m2?.titre).toBe('Message LinkedIn');
  });

  it('keeps each instance apart', async () => {
    const lire = () => Promise.resolve([notif('m9', 'Léa Fictive vous a envoyé un message')]);
    await withInstance(t.app.db, autre.id, (tx) => actualiserLinkedin(tx, lire));
    expect((await sujetsDe(autre.id)).map((s) => s.source_id)).toEqual(['m9']);
    expect((await sujetsDe(simatis.id)).map((s) => s.source_id)).not.toContain('m9');
  });
});

describe('LinkedIn : lecture du texte complet', () => {
  let t: TestApp;
  let simatis: Instance;
  let autre: Instance;

  beforeAll(async () => {
    t = await setupTestApp();
    simatis = await createInstance(t.owner.db, { slug: 'lkt-simatis', nom: 'S', type: 'propre' });
    autre = await createInstance(t.owner.db, { slug: 'lkt-autre', nom: 'A', type: 'mandat' });
  });

  afterAll(async () => {
    await t.drop();
  });

  const deposer = (instanceId: string, notifs: NotificationMail[]) =>
    withInstance(t.app.db, instanceId, (tx) =>
      actualiserLinkedin(tx, () => Promise.resolve(notifs)),
    );
  const dans = <T>(instanceId: string, f: Parameters<typeof withInstance<T>>[2]) =>
    withInstance(t.app.db, instanceId, f);
  const ligne = async (instanceId: string, messageId: string) =>
    (
      await t.owner.pool.query<{
        id: string;
        titre: string;
        resume: string | null;
        texte_lu_at: Date | null;
      }>(
        'select id, titre, resume, texte_lu_at from sujets where instance_id = $1 and source_id = $2',
        [instanceId, messageId],
      )
    ).rows[0];

  it('offers the entries still at the mail preview, oldest first, five at most', async () => {
    await deposer(
      simatis.id,
      Array.from({ length: LECTURES_MAX + 2 }, (_, i) => notif(`a${i}`, 'Message LinkedIn')),
    );
    const liste = await dans(simatis.id, (tx) => messagesALire(tx));
    expect(liste).toHaveLength(LECTURES_MAX);
    expect(liste[0]).toMatchObject({
      titre: 'Message LinkedIn',
      apercu: 'Bonjour, pouvons-nous échanger cette semaine ?',
    });
    expect(await dans(simatis.id, compterMessagesALire)).toBe(LECTURES_MAX + 2);
    expect(await dans(autre.id, compterMessagesALire)).toBe(0);
  });

  it('stores the text read on LinkedIn, names the sender, and stops offering the entry', async () => {
    await deposer(simatis.id, [notif('b1', 'Votre résumé de la semaine')]);
    const avant = await ligne(simatis.id, 'b1');
    expect(avant?.texte_lu_at).toBeNull();
    const statut = await dans(simatis.id, (tx) =>
      enregistrerMessage(tx, avant?.id ?? '', {
        texte: '  Bonjour, voici ma proposition complète.  ',
        expediteur: 'Paul Fictif',
      }),
    );
    expect(statut).toBe('enregistre');
    const apres = await ligne(simatis.id, 'b1');
    expect(apres).toMatchObject({
      titre: 'Message LinkedIn de Paul Fictif',
      resume: 'Bonjour, voici ma proposition complète.',
    });
    expect(apres?.texte_lu_at).not.toBeNull();
    const encore = await dans(simatis.id, (tx) => messagesALire(tx, 50));
    expect(encore.map((m) => m.id)).not.toContain(avant?.id);
  });

  it('keeps a title that already names the sender, and the preview when no text is given', async () => {
    await deposer(simatis.id, [notif('c1', 'Léa Fictive vous a envoyé un message')]);
    const avant = await ligne(simatis.id, 'c1');
    await dans(simatis.id, (tx) =>
      enregistrerMessage(tx, avant?.id ?? '', { expediteur: 'Autre Nom' }),
    );
    const apres = await ligne(simatis.id, 'c1');
    expect(apres?.titre).toBe('Message LinkedIn de Léa Fictive');
    expect(apres?.resume).toBe(avant?.resume);
    expect(apres?.texte_lu_at).not.toBeNull();
  });

  it('refuses an entry of another instance, a missing one, or one that is not from LinkedIn', async () => {
    await deposer(simatis.id, [notif('d1', 'Message LinkedIn')]);
    const d1 = await ligne(simatis.id, 'd1');
    expect(await dans(autre.id, (tx) => enregistrerMessage(tx, d1?.id ?? '', { texte: 'x' }))).toBe(
      'introuvable',
    );
    expect(
      await dans(simatis.id, (tx) =>
        enregistrerMessage(tx, '00000000-0000-4000-8000-000000000000', { texte: 'x' }),
      ),
    ).toBe('introuvable');
    expect((await ligne(simatis.id, 'd1'))?.texte_lu_at).toBeNull();
  });
});
