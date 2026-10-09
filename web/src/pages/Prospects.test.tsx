// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Parametres } from './Parametres.js';
import { Portefeuille } from './Portefeuille.js';

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];

const fiche = {
  slug: 'demo',
  nom: 'Démo Fonderie',
  sous: '',
  type: 'prospect',
  couleur: '#E3A33B',
  modules: [],
  statut: 'actif',
  ecrituresReelles: false,
  creeeLe: '2026-10-01T08:00:00Z',
};

function fakeFetch(url: string, init?: { method?: string; body?: string }) {
  const method = init?.method ?? 'GET';
  calls.push({ url, method, body: init?.body ? (JSON.parse(init.body) as unknown) : undefined });
  const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body)));
  if (url === '/api/prospects') return json({ ...fiche, slug: 'atelier-neuf' });
  if (url === '/api/portefeuille') return json([]);
  if (method === 'POST') return json({ ok: true });
  return json(fiche);
}

describe('prospect screens', () => {
  beforeEach(() => {
    calls = [];
    vi.stubGlobal('fetch', vi.fn(fakeFetch));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('creates a prospect from the portfolio and opens it', async () => {
    const onCreated = vi.fn();
    render(<Portefeuille instances={[]} onCreated={onCreated} />);
    fireEvent.change(screen.getByPlaceholderText('Nom du prospect'), {
      target: { value: 'Atelier Neuf' },
    });
    fireEvent.click(screen.getByText('Créer la démonstration'));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(calls.find((c) => c.url === '/api/prospects')?.body).toEqual({ nom: 'Atelier Neuf' });
    expect(location.hash).toBe('#/atelier-neuf/brief');
  });

  it('asks a second click before resetting the demo', async () => {
    render(<Parametres slug="demo" onRenamed={() => undefined} />);
    fireEvent.click(await screen.findByText('Réinitialiser la démo'));
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    fireEvent.click(screen.getByText('Confirmer la réinitialisation'));
    await waitFor(() =>
      expect(calls.some((c) => c.url === '/api/i/demo/demo/reinitialiser')).toBe(true),
    );
    expect(await screen.findByText('Démonstration réinitialisée.')).toBeTruthy();
  });
});
