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
const limites = {
  actualiseLe: '2026-11-12T13:18:00.000Z',
  fournisseurs: [
    {
      id: 'claude',
      nom: 'Claude',
      etat: 'ok',
      plan: 'Pro',
      fenetre5h: { restant: 72, reinitialiseLe: '2026-11-12T15:00:00.000Z' },
      hebdomadaire: { restant: 28, reinitialiseLe: '2026-11-16T08:00:00.000Z' },
    },
    {
      id: 'chatgpt',
      nom: 'ChatGPT',
      etat: 'ok',
      plan: 'Plus',
      fenetre5h: { restant: 84, reinitialiseLe: '2026-11-12T16:25:00.000Z' },
      hebdomadaire: { restant: 63, reinitialiseLe: '2026-11-14T23:00:00.000Z' },
    },
  ],
};

describe('Console (journal en lecture seule)', () => {
  beforeEach(() => {
    reponse = { lignes, enCours: false };
    urls = [];
    localStorage.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        urls.push(url);
        return Promise.resolve(
          new Response(JSON.stringify(url === '/api/limites-ia' ? limites : reponse)),
        );
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
    expect(urls).toContain('/api/i/simatis/console');
    fireEvent.click(screen.getByLabelText('Déplier la console'));
    expect(await screen.findByText('Tâche créée : Appeler')).toBeTruthy();
    expect(screen.getByRole('log').textContent).toContain('ACME non rangé');
  });

  it('labels each line with what its colour means', async () => {
    render(<Console slug="simatis" />);
    await screen.findByText('Test de VMA reçu : ACME non rangé');
    fireEvent.click(screen.getByLabelText('Déplier la console'));
    const journal = screen.getByRole('log');
    expect(journal.textContent).toContain('INFO');
    expect(journal.textContent).toContain('À VOIR');
  });

  it('keeps the 5-hour and weekly limits visible when the log is folded', async () => {
    render(<Console slug="simatis" />);
    await screen.findByText('Test de VMA reçu : ACME non rangé');

    expect(await screen.findByText('Claude')).toBeTruthy();
    expect(screen.getByText('ChatGPT')).toBeTruthy();
    expect(screen.getByText('72 %')).toBeTruthy();
    expect(screen.getByText('28 %')).toBeTruthy();
    expect(screen.getByText('84 %')).toBeTruthy();
    expect(screen.getByText('63 %')).toBeTruthy();
    expect(screen.getAllByText('5 h')).toHaveLength(2);
    expect(screen.getAllByText('Sem.')).toHaveLength(2);
    expect(screen.queryByRole('log')).toBeNull();

    fireEvent.click(screen.getByLabelText('Déplier la console'));
    expect(screen.getByRole('log')).toBeTruthy();
    expect(screen.getByText('Claude')).toBeTruthy();
    expect(screen.getByText('72 % restant')).toBeTruthy();
    expect(screen.getByText('28 % restant')).toBeTruthy();
    expect(screen.getByText('84 % restant')).toBeTruthy();
    expect(screen.getByText('63 % restant')).toBeTruthy();
    expect(screen.getAllByText('Fenêtre 5 h')).toHaveLength(2);
    expect(screen.getAllByText('Hebdomadaire')).toHaveLength(2);
    expect(screen.queryByText('Sem.')).toBeNull();
    expect(screen.getAllByText('Test de VMA reçu : ACME non rangé')).toHaveLength(1);

    fireEvent.click(screen.getByLabelText('Actualiser les limites IA'));
    await waitFor(() =>
      expect(urls.filter((url) => url === '/api/limites-ia').length).toBeGreaterThan(1),
    );
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
    await waitFor(() =>
      expect(urls.filter((url) => url === '/api/i/simatis/console').length).toBeGreaterThan(1),
    );
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

describe('Commutateur du moteur IA', () => {
  let enregistre: unknown[];
  beforeEach(() => {
    enregistre = [];
    localStorage.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (url === '/api/preferences/options') {
          enregistre.push(JSON.parse(init?.body as string));
          return Promise.resolve(new Response(JSON.stringify({ options: {} })));
        }
        if (url === '/api/preferences')
          return Promise.resolve(
            new Response(JSON.stringify({ favoris: [], options: { moteurIA: 'claude' } })),
          );
        return Promise.resolve(
          new Response(
            JSON.stringify(url === '/api/limites-ia' ? limites : { lignes: [], enCours: false }),
          ),
        );
      }),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('allume le moteur enregistré et enregistre le nouveau choix au clic', async () => {
    render(<Console slug="simatis" />);
    const claude = screen.getByRole('radio', { name: 'Claude' });
    const codex = screen.getByRole('radio', { name: 'Codex' });
    await waitFor(() => expect(claude.getAttribute('aria-checked')).toBe('true'));
    expect(codex.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(codex);
    expect(codex.getAttribute('aria-checked')).toBe('true');
    expect(claude.getAttribute('aria-checked')).toBe('false');
    await waitFor(() => expect(enregistre).toEqual([{ moteurIA: 'codex' }]));
  });

  it('revient au moteur précédent si le choix n’est pas enregistré', async () => {
    render(<Console slug="simatis" />);
    const claude = screen.getByRole('radio', { name: 'Claude' });
    await waitFor(() => expect(claude.getAttribute('aria-checked')).toBe('true'));
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{}', { status: 500 }))),
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Codex' }));
    await waitFor(() => expect(claude.getAttribute('aria-checked')).toBe('true'));
  });
});
