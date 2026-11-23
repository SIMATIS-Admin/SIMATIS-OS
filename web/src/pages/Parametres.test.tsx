// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Parametres } from './Parametres.js';

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let fiche: Record<string, unknown>;

beforeEach(() => {
  calls = [];
  fiche = {
    slug: 'beta',
    nom: 'Beta',
    sous: 'Mandat',
    type: 'mandat',
    phase: 'en_cours',
    couleur: '#000',
    modules: [],
    statut: 'actif',
    ecrituresReelles: false,
    creeeLe: '2026-10-01T00:00:00Z',
  };
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? (JSON.parse(init.body as string) as unknown) : undefined;
      calls.push({ url, method, body });
      if (method === 'PUT' && url.endsWith('/phase')) {
        fiche = { ...fiche, ...(body as object) };
        return Promise.resolve(new Response(JSON.stringify(fiche)));
      }
      return Promise.resolve(new Response(JSON.stringify(fiche)));
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Paramètres, phase of a mandate', () => {
  it('shows the phase of a mandate and switches it to closing', async () => {
    render(<Parametres slug="beta" onRenamed={() => undefined} />);
    expect(await screen.findAllByText('Mandat en cours')).not.toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Closing' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        url: '/api/i/beta/phase',
        method: 'PUT',
        body: { phase: 'closing' },
      }),
    );
    expect(await screen.findAllByText('Mandat en Closing')).not.toHaveLength(0);
  });

  it('labels a demo and offers no phase', async () => {
    fiche = { ...fiche, type: 'prospect', phase: null };
    render(<Parametres slug="beta" onRenamed={() => undefined} />);
    expect(await screen.findAllByText('Démo')).not.toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Closing' })).toBeNull();
  });
});

describe('Paramètres, onglet Devis', () => {
  it('apparaît seulement pour l’activité propre qui a le module devis', async () => {
    fiche = { ...fiche, type: 'propre', phase: null, modules: ['devis'] };
    render(<Parametres slug="simatis" onRenamed={() => undefined} />);
    expect(await screen.findByRole('button', { name: 'Devis' })).toBeTruthy();
    cleanup();
    fiche = { ...fiche, modules: [] };
    render(<Parametres slug="simatis" onRenamed={() => undefined} />);
    await screen.findAllByText('Activité');
    expect(screen.queryByRole('button', { name: 'Devis' })).toBeNull();
  });
});

describe("Paramètres, journal d'audit", () => {
  it("ouvre le journal d'audit depuis un onglet", async () => {
    const base = fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>;
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
      url.endsWith('/journal')
        ? (calls.push({ url, method: 'GET', body: undefined }), Promise.resolve(new Response('[]')))
        : base(url, init),
    );
    render(<Parametres slug="beta" onRenamed={() => undefined} />);
    fireEvent.click(await screen.findByRole('button', { name: "Journal d'audit" }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/i/beta/journal')).toBe(true));
  });
});
