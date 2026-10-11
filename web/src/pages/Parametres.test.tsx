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
