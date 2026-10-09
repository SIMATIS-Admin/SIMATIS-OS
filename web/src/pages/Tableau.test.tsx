// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Tableau } from './Tableau.js';

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
const funnel = { leads: 60, l2p: 30, p2d: 45, d2c: 35, panier: 16000, objectif: 150000 };

function fakeFetch(url: string, init?: { method?: string; body?: string }) {
  const method = init?.method ?? 'GET';
  calls.push({ url, method, body: init?.body ? (JSON.parse(init.body) as unknown) : undefined });
  return Promise.resolve(
    new Response(
      JSON.stringify({
        pipeline: { montant: 120000, nombre: 9 },
        chaudes: { montant: 40000, nombre: 2 },
        derniereCampagne: null,
        funnel,
        simulation: {},
      }),
    ),
  );
}

describe('Tableau de bord', () => {
  beforeEach(() => {
    calls = [];
    vi.stubGlobal('fetch', vi.fn(fakeFetch));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the indicators and the yearly revenue of the mockup', async () => {
    render(<Tableau slug="simatis" />);
    expect(await screen.findByText('9 opportunités')).toBeTruthy();
    expect(screen.getByText('Aucune campagne lancée')).toBeTruthy();
    expect(screen.getByText(/544\s320 €/)).toBeTruthy();
    expect(screen.getByText(/La trajectoire est tenue/)).toBeTruthy();
  });

  it('redraws at once and saves the moved slider', async () => {
    render(<Tableau slug="simatis" />);
    fireEvent.change(await screen.findByLabelText('Leads par mois'), { target: { value: '10' } });
    expect(screen.getByText(/Il faudrait/)).toBeTruthy();
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true), {
      timeout: 2000,
    });
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({
      url: '/api/i/simatis/funnel',
      body: { leads: 10 },
    });
  });
});
