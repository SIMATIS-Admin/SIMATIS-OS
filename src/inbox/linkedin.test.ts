import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import type { NotificationMail } from '../connecteurs/google/google.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { actualiserLinkedin, expediteurLinkedin } from './linkedin.js';

const notif = (id: string, objet: string, extra: Partial<NotificationMail> = {}) => ({
  messageId: id,
  threadId: `t-${id}`,
  de: 'LinkedIn <messages-noreply@linkedin.com>',
  objet,
  date: 'Mon, 5 Oct 2026 09:00:00 +0200',
  extrait: 'Bonjour, pouvons-nous échanger cette semaine ?',
  ...extra,
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
