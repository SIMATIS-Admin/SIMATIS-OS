// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConsoleOS } from '../api.js';
import { Console } from './Console.js';

const lignes: ConsoleOS['lignes'] = [
  {
    id: 'j1',
    at: '2026-10-22T08:00:00Z',
    source: 'journal',
    acteur: 'pilote',
    niveau: 'info',
    texte: 'Tâche créée : Appeler',
  },
  {
    id: 'x1:attente0',
    at: '2026-10-22T08:05:00Z',
    source: 'routine',
    acteur: 'routine:inbox',
    niveau: 'attention',
    texte: 'Test de VMA reçu : ACME non rangé',
  },
];
let reponse: ConsoleOS;
let urls: string[];

describe('Console (journal en lecture seule)', () => {
  beforeEach(() => {
    reponse = { lignes, enCours: false };
    urls = [];
    localStorage.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        urls.push(url);
        return Promise.resolve(new Response(JSON.stringify(reponse)));
      }),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('is folded on the latest message, and opens on a click to list everything', async () => {
    render(<Console slug="simatis" />);
    expect(await screen.findByText('Test de VMA reçu : ACME non rangé')).toBeTruthy();
    expect(screen.queryByText('Tâche créée : Appeler')).toBeNull();
    expect(urls[0]).toBe('/api/i/simatis/console');
    fireEvent.click(screen.getByLabelText('Déplier la console'));
    expect(await screen.findByText('Tâche créée : Appeler')).toBeTruthy();
    expect(screen.getByRole('log').textContent).toContain('ACME non rangé');
  });

  it('empties the display without losing anything, then shows everything again', async () => {
    render(<Console slug="simatis" />);
    await screen.findByText('Test de VMA reçu : ACME non rangé');
    fireEvent.click(screen.getByText('Vider'));
    expect(await screen.findByText('Tout est calme, rien à signaler.')).toBeTruthy();
    expect(localStorage.getItem('console-vide-simatis')).toBe('2026-10-22T08:05:00Z');
    fireEvent.click(screen.getByText('tout réafficher (2)'));
    expect(await screen.findByText('Test de VMA reçu : ACME non rangé')).toBeTruthy();
    expect(localStorage.getItem('console-vide-simatis')).toBeNull();
  });

  it('shows a line that arrives after a clear, and Claude working', async () => {
    reponse = { lignes, enCours: true };
    render(<Console slug="simatis" />);
    await screen.findByText('Test de VMA reçu : ACME non rangé');
    fireEvent.click(screen.getByText('Vider'));
    reponse = {
      lignes: [
        ...lignes,
        {
          id: 'j2',
          at: '2026-10-22T09:00:00Z',
          source: 'journal',
          acteur: 'os',
          niveau: 'info',
          texte: 'Nouveau message',
        },
      ],
      enCours: true,
    };
    fireEvent.click(screen.getByLabelText('Déplier la console'));
    await waitFor(() => expect(urls.length).toBeGreaterThan(1));
    await waitFor(() => expect(screen.getByRole('log').textContent).toContain('Nouveau message'));
    expect(screen.getByText(/Claude travaille/)).toBeTruthy();
    expect(screen.queryByText('Tâche créée : Appeler')).toBeNull();
  });

  it('says so when the console cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('hors ligne'))),
    );
    render(<Console slug="simatis" />);
    expect(await screen.findByText('Console injoignable…')).toBeTruthy();
  });
});
