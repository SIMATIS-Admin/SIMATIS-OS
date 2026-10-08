// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Connexions } from './Connexions.js';

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let tokenPresent = true;

const reponse = () => ({
  connexions: [
    {
      kind: 'crm',
      fournisseur: 'hubspot',
      etat: 'ok',
      reglages: { frequence: '15min', sens: 'lecture', champsExclus: ['annualrevenue'] },
      derniereSynchro: new Date().toISOString(),
      derniereErreur: null,
      secret: { nom: 'HUBSPOT_TOKEN', present: tokenPresent },
    },
  ],
  options: {
    objets: ['entreprises', 'contacts', 'transactions', 'taches'],
    champs: [
      { cle: 'phone', libelle: 'Téléphone' },
      { cle: 'annualrevenue', libelle: "Chiffre d'affaires annuel" },
    ],
  },
  ecrituresReelles: false,
});

function fakeFetch(url: string, init?: { method?: string; body?: string }) {
  const method = init?.method ?? 'GET';
  calls.push({ url, method, body: init?.body ? (JSON.parse(init.body) as unknown) : undefined });
  const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body)));
  if (method === 'POST') return json({ lus: 4, crees: 1, maj: 3 });
  if (method === 'PATCH') return json({ reglages: {} });
  return json(reponse());
}

describe('Paramètres > Connexions', () => {
  beforeEach(() => {
    calls = [];
    tokenPresent = true;
    vi.stubGlobal('fetch', vi.fn(fakeFetch));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the HubSpot connection as connected, read-only, with simulated writes', async () => {
    render(<Connexions slug="helioval" />);
    expect(await screen.findByText('Connecté')).toBeTruthy();
    expect(screen.getByText(/Écritures réelles désactivées/)).toBeTruthy();
    expect(screen.getByDisplayValue<HTMLSelectElement>(/lecture seule/).value).toBe('lecture');
  });

  it('excludes a field when it is unchecked', async () => {
    render(<Connexions slug="helioval" />);
    fireEvent.click(await screen.findByLabelText('Téléphone'));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({
      url: '/api/i/helioval/connexions/crm',
      body: { champsExclus: ['annualrevenue', 'phone'] },
    });
  });

  it('synchronizes on demand and reports the result', async () => {
    render(<Connexions slug="helioval" />);
    fireEvent.click(await screen.findByText('Synchroniser maintenant'));
    expect(await screen.findByText(/4 lus, 1 créés, 3 mis à jour/)).toBeTruthy();
  });

  it('tells where to put a missing token', async () => {
    tokenPresent = false;
    render(<Connexions slug="helioval" />);
    expect(await screen.findByText('secrets/instances/helioval.env')).toBeTruthy();
  });
});
