// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationMail, documentMail, regrouperMails, texteMail } from './ConversationsMail.js';
import type { Evenement } from '../api.js';

const messages: Evenement[] = [
  {
    id: 'a',
    type: 'email',
    titre: 'Envoyé · Projet fictif',
    texte: 'Extrait',
    at: '2026-10-01T09:00:00Z',
    origine: 'os',
    mail: {
      fil: 'boite:fil',
      objet: 'Projet fictif',
      de: 'pilote@exemple.test',
      a: 'contact@exemple.test',
      sens: 'envoye',
      reponse: false,
    },
  },
  {
    id: 'b',
    type: 'email',
    titre: 'Reçu · Re: Projet fictif',
    texte: 'Extrait',
    at: '2026-10-01T10:00:00Z',
    origine: 'os',
    mail: {
      fil: 'boite:fil',
      objet: 'Re: Projet fictif',
      de: 'contact@exemple.test',
      a: 'pilote@exemple.test',
      sens: 'recu',
      reponse: true,
      lien: 'https://mail.google.com/',
    },
  },
];
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Conversations mail', () => {
  it('regroupe par identifiant et conserve deux fils distincts malgré leur objet identique', () => {
    expect(
      regrouperMails([
        ...messages,
        { ...messages[0]!, id: 'c', mail: { ...messages[0]!.mail!, fil: 'autre:fil' } },
      ]).size,
    ).toBe(2);
  });
  it('décode les entités sans interpréter du HTML', () => {
    expect(texteMail('L&#39;échange &amp; <img src=x>')).toBe(
      'L’échange & <img src=x>'.replace('’', "'"),
    );
  });
  it('isole le HTML, retire les scripts, formulaires et images distantes et replie les citations', () => {
    const doc = new DOMParser().parseFromString(
      documentMail(
        '<script>alert(1)</script><meta http-equiv="refresh" content="0;url=https://exemple.test"><p onclick="alert(1)">Bonjour <b>ici</b></p><form><input></form><a href="javascript:alert(1)">Danger</a><img src="https://exemple.test/pixel"><blockquote>Ancien message</blockquote><div class="gmail_signature">Signature</div>',
      ),
      'text/html',
    );
    expect(doc.querySelector('script,form,input,[onclick],img[src]')).toBeNull();
    expect(doc.querySelector('a')?.hasAttribute('href')).toBe(false);
    expect(doc.querySelector('p b')?.textContent).toBe('ici');
    expect(doc.querySelectorAll('details:not([open])').length).toBe(2);
    expect(
      doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content'),
    ).toContain("default-src 'none'");
    expect(doc.querySelector('meta[http-equiv="refresh"]')).toBeNull();
  });
  it('replie aussi la signature et tout l’historique cité par Outlook', () => {
    const doc = new DOMParser().parseFromString(
      documentMail(
        '<p>Message actuel</p><div id="Signature">Signature fictive</div><hr><div id="divRplyFwdMsg">En-tête précédent</div><div>Ancien contenu</div>',
      ),
      'text/html',
    );
    expect(doc.querySelector('details #Signature')?.textContent).toBe('Signature fictive');
    expect(doc.querySelector('details #divRplyFwdMsg')?.parentElement?.textContent).toContain(
      'Ancien contenu',
    );
    expect(doc.querySelectorAll('details:not([open])').length).toBe(2);
    expect(doc.querySelector('body > p')?.textContent).toBe('Message actuel');
  });

  it('reste sur une ligne puis charge uniquement le dernier message à l’ouverture, et permet de replier', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          mails: [
            {
              ...messages[1],
              mail: {
                ...messages[1]!.mail,
                html: '<p>Réponse <b>complète</b></p>',
                charge: true,
              },
            },
          ],
          adresses: 1,
        }),
      ),
    );
    vi.stubGlobal('fetch', fetch);
    const { container } = render(
      <ConversationMail
        messages={messages}
        contexte={{ slug: 'fictif', kind: 'affaire', id: '1' }}
      />,
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByText('2 messages')).toBeTruthy();
    const thread = container.querySelector('details')!;
    thread.open = true;
    fireEvent(thread, new Event('toggle'));
    const iframe = await screen.findByTitle('Contenu du mail : Re: Projet fictif');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toContain('?message=b');
    expect(iframe.getAttribute('sandbox')).not.toContain('allow-scripts');
    expect(iframe.getAttribute('srcdoc')).toContain('complète');
    expect(screen.getByText('Réponse dans ce fil')).toBeTruthy();
    thread.open = false;
    fireEvent(thread, new Event('toggle'));
    await waitFor(() => expect(container.querySelector('iframe')).toBeNull());
  });
  it('affiche une erreur et permet de réessayer sans perdre le fil', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('injoignable'));
    vi.stubGlobal('fetch', fetch);
    const { container } = render(
      <ConversationMail
        messages={messages}
        contexte={{ slug: 'fictif', kind: 'affaire', id: '1' }}
      />,
    );
    container.querySelector('details')!.open = true;
    fireEvent(container.querySelector('details')!, new Event('toggle'));
    expect(await screen.findByRole('alert')).toBeTruthy();
    fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          mails: [
            {
              ...messages[1],
              mail: { ...messages[1]!.mail, corps: 'Texte complet', charge: true },
            },
          ],
          adresses: 1,
        }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText('Texte complet')).toBeTruthy();
  });
});
