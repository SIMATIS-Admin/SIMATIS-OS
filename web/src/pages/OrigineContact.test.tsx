// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { OrigineContact } from './OrigineContact.js';
import { libelleZone } from './BaseTable.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('affiche le contexte et un lien vers la source dans une popup', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        Response.json({
          provenance: 'Recherche Codex',
          collecteLe: null,
          notes: [
            {
              date: '2026-01-01',
              origine: 'Recherche Codex',
              texte: 'Qualification fictive sourcée.',
              source: 'https://atelier.example/equipe',
            },
          ],
        }),
      ),
    ),
  );
  render(<OrigineContact slug="fictif" id="fictif" nom="Alice Exemple" fermer={vi.fn()} />);
  expect(await screen.findByText('Qualification fictive sourcée.')).toBeTruthy();
  expect(
    (await screen.findByRole('link', { name: 'Consulter la source' })).getAttribute('href'),
  ).toBe('https://atelier.example/equipe');
});
it('affiche une pastille LinkedIn bleue pour un contact sans email nominatif', () => {
  const { container } = render(
    libelleZone({
      zone: 'a_enrichir',
      nom: 'Exemple',
      linkedin: 'https://www.linkedin.com/in/alice-exemple',
      email: null,
      emailInvalide: false,
    }),
  );
  expect(screen.getByText('LinkedIn')).toBeTruthy();
  expect(container.querySelector('.badge.linkedin')).not.toBeNull();
});
