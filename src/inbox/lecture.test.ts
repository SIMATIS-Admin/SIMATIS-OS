import { describe, expect, it } from 'vitest';
import type { Evenement, Fil } from '../connecteurs/google/google.js';
import {
  adresseDe,
  brouillonsAnciens,
  mailsARepondre,
  plusDunJourOuvre,
  rendezVousExternes,
  type Annuaire,
} from './lecture.js';

const MOI = 'pilote@exemple.fr';
const annuaire: Annuaire = {
  contacts: [
    { id: 'c1', email: 'Paul@Client.example', entrepriseId: 'e1' },
    { id: 'c2', email: null, entrepriseId: null },
  ],
  entreprises: [
    { id: 'e1', domaine: 'client.example' },
    { id: 'e2', domaine: 'gmail.com' },
  ],
};
// Wednesday 7 October 2026, 18:00 in Paris.
const MERCREDI = new Date('2026-10-07T16:00:00Z');
const fil = (de: string, date: string, extra: Partial<Fil> = {}): Fil => ({
  threadId: `t-${de}-${date}`,
  de,
  date,
  objet: 'Objet fictif',
  extrait: 'Extrait fictif',
  ...extra,
});

describe('Inbox : sélection des lectures', () => {
  it('reads an address in any usual form', () => {
    expect(adresseDe('Paul Client <Paul@Client.example>')).toBe('paul@client.example');
    expect(adresseDe('paul@client.example')).toBe('paul@client.example');
    expect(adresseDe(null)).toBeNull();
  });

  it('counts working days, skipping the weekend', () => {
    const vendredi = new Date('2026-10-09T08:00:00Z');
    expect(plusDunJourOuvre(vendredi, new Date('2026-10-11T20:00:00Z'))).toBe(false);
    expect(plusDunJourOuvre(vendredi, new Date('2026-10-12T09:00:00Z'))).toBe(true);
    expect(plusDunJourOuvre(new Date('2026-10-06T15:00:00Z'), MERCREDI)).toBe(true);
    expect(plusDunJourOuvre(new Date('2026-10-07T07:00:00Z'), MERCREDI)).toBe(false);
  });

  it('keeps a mail from a known contact left unanswered for a working day', () => {
    const [m] = mailsARepondre(
      [
        fil('Paul Client <paul@client.example>', 'Mon, 5 Oct 2026 09:00:00 +0200', {
          threadId: 't1',
        }),
      ],
      MOI,
      annuaire,
      MERCREDI,
    );
    expect(m).toMatchObject({
      threadId: 't1',
      contactId: 'c1',
      entrepriseId: 'e1',
      lien: 'https://mail.google.com/mail/?authuser=pilote%40exemple.fr#all/t1',
    });
  });

  it('links to the mailbox that holds the thread when it is not Gmail', () => {
    const [m] = mailsARepondre(
      [fil('paul@client.example', 'Mon, 5 Oct 2026 09:00:00 +0200', { threadId: 't1' })],
      MOI,
      annuaire,
      MERCREDI,
      (id) => `https://webmail.example/${id}`,
    );
    expect(m?.lien).toBe('https://webmail.example/t1');
  });

  it('drops a thread whose last message is mine', () => {
    expect(
      mailsARepondre(
        [fil('Pilote <Pilote@exemple.fr>', 'Mon, 5 Oct 2026 09:00:00 +0200')],
        MOI,
        annuaire,
        MERCREDI,
      ),
    ).toEqual([]);
  });

  it('drops a mail too recent, counting working days', () => {
    expect(
      mailsARepondre(
        [fil('paul@client.example', 'Wed, 7 Oct 2026 09:00:00 +0200')],
        MOI,
        annuaire,
        MERCREDI,
      ),
    ).toEqual([]);
  });

  it('matches a company by domain but never a generic one', () => {
    const [m] = mailsARepondre(
      [fil('autre@client.example', 'Mon, 5 Oct 2026 09:00:00 +0200')],
      MOI,
      annuaire,
      MERCREDI,
    );
    expect(m).toMatchObject({ contactId: null, entrepriseId: 'e1' });
    expect(
      mailsARepondre(
        [fil('quelquun@gmail.com', 'Mon, 5 Oct 2026 09:00:00 +0200')],
        MOI,
        annuaire,
        MERCREDI,
      ),
    ).toEqual([]);
  });

  it('drops an unknown sender', () => {
    expect(
      mailsARepondre(
        [fil('inconnu@ailleurs.example', 'Mon, 5 Oct 2026 09:00:00 +0200')],
        MOI,
        annuaire,
        MERCREDI,
      ),
    ).toEqual([]);
  });

  it('keeps only old drafts', () => {
    const b = (draftId: string, date: string) => ({ draftId, objet: 'x', a: 'y', date });
    expect(
      brouillonsAnciens(
        [
          b('vieux', 'Thu, 1 Oct 2026 10:00:00 +0200'),
          b('recent', 'Tue, 6 Oct 2026 10:00:00 +0200'),
        ],
        3,
        MERCREDI,
      ).map((x) => x.draftId),
    ).toEqual(['vieux']);
  });

  it('keeps finished meetings with an outsider, never internal, all-day, future or solo ones', () => {
    const e = (id: string, participants: string[], extra: Partial<Evenement> = {}): Evenement => ({
      id,
      titre: id,
      lieu: null,
      participants,
      debut: new Date('2026-10-06T08:00:00Z'),
      fin: new Date('2026-10-06T09:00:00Z'),
      journee: false,
      lien: `https://calendar.example/${id}`,
      ...extra,
    });
    const retenus = rendezVousExternes(
      [
        e('client', ['paul@client.example', 'collegue@exemple.fr']),
        e('interne', ['collegue@exemple.fr']),
        e('journee', ['paul@client.example'], { journee: true }),
        e('futur', ['paul@client.example'], {
          debut: new Date('2026-10-08T08:00:00Z'),
          fin: new Date('2026-10-08T09:00:00Z'),
        }),
        e('seul', []),
      ],
      'exemple.fr',
      annuaire,
      MERCREDI,
    );
    expect(retenus).toEqual([
      {
        eventId: 'client',
        titre: 'client',
        debut: '2026-10-06T08:00:00.000Z',
        fin: '2026-10-06T09:00:00.000Z',
        participants: ['paul@client.example'],
        lien: 'https://calendar.example/client',
        contactId: 'c1',
        entrepriseId: 'e1',
      },
    ]);
  });
});
