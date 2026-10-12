import { describe, expect, it } from 'vitest';
import type { Instance } from '../../instances/schema.js';
import { brouillons, compteAgenda, compteGmail, evenements, filsRecents } from './google.js';

const ctx = {
  instance: { nom: 'Mandat fictif' } as Instance,
  secrets: { GOOGLE_CLIENT_ID: 'c', GOOGLE_CLIENT_SECRET: 's', GOOGLE_REFRESH_TOKEN: 'rt' },
};
const h = (name: string, value: string) => ({ name, value });

// Fictive Google answering the read calls of the Inbox routine.
function fakeGoogle() {
  const urls: string[] = [];
  const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body)));
  const fetch = (url: string) => {
    urls.push(url);
    if (url.startsWith('https://oauth2.googleapis.com/token')) return json({ access_token: 'at' });
    if (url.endsWith('/profile')) return json({ emailAddress: 'Pilote@Exemple.fr' });
    if (url.includes('/threads?')) return json({ threads: [{ id: 't1' }] });
    if (url.includes('/threads/t1')) {
      return json({
        id: 't1',
        messages: [
          { id: 'a', snippet: 'premier', payload: { headers: [h('From', 'x@client.example')] } },
          {
            id: 'b',
            snippet: 'Pouvez-vous me rappeler ?',
            payload: {
              headers: [
                h('From', 'Paul Client <paul@client.example>'),
                h('Subject', 'Rappel'),
                h('Date', 'Mon, 5 Oct 2026 09:00:00 +0200'),
              ],
            },
          },
        ],
      });
    }
    if (url.includes('/drafts?')) return json({ drafts: [{ id: 'd1' }] });
    if (url.includes('/drafts/d1')) {
      return json({
        id: 'd1',
        message: {
          payload: {
            headers: [
              h('Subject', 'Relance'),
              h('To', 'paul@client.example'),
              h('Date', 'Thu, 1 Oct 2026 10:00:00 +0200'),
            ],
          },
        },
      });
    }
    if (url.endsWith('/calendars/primary')) return json({ id: 'pilote@exemple.fr' });
    if (url.includes('/events?')) {
      return json({
        items: [
          {
            id: 'e1',
            summary: 'Point fictif',
            htmlLink: 'https://calendar.google.com/event?eid=e1',
            attendees: [{ email: 'paul@client.example' }],
            start: { dateTime: '2026-10-05T09:00:00+02:00' },
            end: { dateTime: '2026-10-05T10:00:00+02:00' },
          },
        ],
      });
    }
    return Promise.resolve(new Response('{}', { status: 404 }));
  };
  return { urls, fetch };
}

describe('Google : lectures de la routine Inbox', () => {
  it('reads the Gmail account', async () => {
    const g = fakeGoogle();
    expect(await compteGmail(ctx, g)).toBe('pilote@exemple.fr');
  });

  it('keeps the last message of each recent thread', async () => {
    const g = fakeGoogle();
    expect(await filsRecents(ctx, 14, g)).toEqual([
      {
        threadId: 't1',
        de: 'Paul Client <paul@client.example>',
        date: 'Mon, 5 Oct 2026 09:00:00 +0200',
        objet: 'Rappel',
        extrait: 'Pouvez-vous me rappeler ?',
      },
    ]);
    expect(g.urls.find((u) => u.includes('/threads?'))).toContain(
      encodeURIComponent('in:inbox newer_than:14d').replace(/%20/g, '+'),
    );
  });

  it('lists drafts with subject, recipient and date', async () => {
    const g = fakeGoogle();
    expect(await brouillons(ctx, g)).toEqual([
      {
        draftId: 'd1',
        objet: 'Relance',
        a: 'paul@client.example',
        date: 'Thu, 1 Oct 2026 10:00:00 +0200',
      },
    ]);
  });

  it('gives the link of a meeting and the agenda account', async () => {
    const g = fakeGoogle();
    const [e] = await evenements(
      ctx,
      new Date('2026-10-01'),
      new Date('2026-10-10'),
      ['primary'],
      g,
    );
    expect(e?.lien).toBe('https://calendar.google.com/event?eid=e1');
    expect(await compteAgenda(ctx, g)).toBe('pilote@exemple.fr');
  });
});
