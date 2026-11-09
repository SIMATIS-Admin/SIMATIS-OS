// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Fiche } from './Fiche.js';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('réduit et réaffiche un compte rendu sans masquer son titre', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            url.includes('/mails')
              ? { mails: [] }
              : {
                  kind: 'entreprise',
                  fiche: { id: 'e', nom: 'Organisation fictive', origine: 'os' },
                  liens: {},
                  aVenir: [],
                  rendezVous: [],
                  ecrit: false,
                  historique: [
                    {
                      id: 'cr',
                      type: 'compte_rendu',
                      titre: 'Réunion fictive',
                      texte: 'Contenu fictif du compte rendu',
                      at: '2026-01-01',
                      origine: 'os',
                    },
                  ],
                },
          ),
        ),
      ),
    ),
  );
  render(<Fiche slug="demo" kind="entreprise" id="e" />);
  const bouton = await screen.findByRole('button', { name: 'Réduire le compte rendu' });
  expect(bouton.textContent).toBe('');
  expect(bouton.getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(bouton);
  expect(bouton.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByText('Contenu fictif du compte rendu')).toBeNull();
  expect(screen.getByText('Réunion fictive')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Afficher le compte rendu' }));
  expect(screen.getByText('Contenu fictif du compte rendu')).toBeTruthy();
});
