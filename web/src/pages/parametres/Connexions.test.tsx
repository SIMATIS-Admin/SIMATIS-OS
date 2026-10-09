// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Connexions } from './Connexions.js';

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let tokenPresent = true;
let avecGoogle = false;
let clientDisponible = true;

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
    ...(avecGoogle
      ? [
          {
            kind: 'messagerie',
            fournisseur: 'gmail',
            etat: 'ok',
            reglages: { historiqueMois: 12, contenu: 'extraits' },
            derniereSynchro: null,
            derniereErreur: null,
            secret: { nom: 'GOOGLE_REFRESH_TOKEN', present: true },
          },
        ]
      : []),
  ],
  options: {
    objets: ['entreprises', 'contacts', 'transactions', 'taches'],
    champs: [
      { cle: 'phone', libelle: 'Téléphone' },
      { cle: 'annualrevenue', libelle: "Chiffre d'affaires annuel" },
    ],
  },
  googleClientDisponible: clientDisponible,
  ecrituresReelles: false,
});

function fakeFetch(url: string, init?: { method?: string; body?: string }) {
  const method = init?.method ?? 'GET';
  calls.push({ url, method, body: init?.body ? (JSON.parse(init.body) as unknown) : undefined });
  const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body)));
  if (url.endsWith('/connexions/hubspot')) {
    const ok = (calls.at(-1)?.body as { token: string }).token === 'pat-eu1-bon';
    return Promise.resolve(
      new Response(JSON.stringify(ok ? { ok: true } : { error: 'HubSpot refuse ce jeton' }), {
        status: ok ? 200 : 400,
      }),
    );
  }
  if (url.endsWith('/google/start')) return json({ url: 'https://accounts.example/consent' });
  if (method === 'POST') return json({ lus: 4, crees: 1, maj: 3 });
  if (method === 'PATCH') return json({ reglages: {} });
  return json(reponse());
}

describe('Paramètres > Connexions', () => {
  beforeEach(() => {
    calls = [];
    tokenPresent = true;
    avecGoogle = false;
    clientDisponible = true;
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

  it('connects HubSpot from the screen when the token is missing, and shows a refusal', async () => {
    tokenPresent = false;
    render(<Connexions slug="helioval" />);
    const input = await screen.findByPlaceholderText('pat-eu1-…');
    fireEvent.change(input, { target: { value: 'pat-eu1-faux' } });
    fireEvent.click(screen.getByText('Vérifier et brancher HubSpot'));
    expect(await screen.findByText(/HubSpot refuse ce jeton/)).toBeTruthy();

    fireEvent.change(input, { target: { value: 'pat-eu1-bon' } });
    fireEvent.click(screen.getByText('Vérifier et brancher HubSpot'));
    await waitFor(() =>
      expect(calls.filter((c) => c.url.endsWith('/connexions/hubspot')).length).toBe(2),
    );
    await waitFor(() => expect(calls.at(-1)?.url).toBe('/api/i/helioval/connexions'));
  });

  it('shows the Gmail locks and saves the history depth', async () => {
    avecGoogle = true;
    render(<Connexions slug="helioval" />);
    expect(await screen.findByText(/sans signature/)).toBeTruthy();
    expect(screen.getByText(/Aucun envoi direct/)).toBeTruthy();
    fireEvent.change(screen.getByDisplayValue('12 mois'), { target: { value: '24' } });
    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith('/connexions/messagerie'))).toBe(true),
    );
    expect(calls.find((c) => c.url.endsWith('/connexions/messagerie'))?.body).toEqual({
      historiqueMois: 24,
    });
  });

  it('sends the pilot to Google consent from the button', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, hash: '', assign });
    render(<Connexions slug="helioval" />);
    fireEvent.click((await screen.findAllByText('Connecter le compte Google'))[0] as HTMLElement);
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://accounts.example/consent'));
    expect(calls.find((c) => c.url.endsWith('/google/start'))?.body).toEqual({});
  });

  it('never asks the pilot for a Google client ID when the OS has none', async () => {
    clientDisponible = false;
    render(<Connexions slug="helioval" />);
    expect(await screen.findByText(/Bouton inactif/)).toBeTruthy();
    expect(screen.getByText<HTMLButtonElement>('Connecter le compte Google').disabled).toBe(true);
    expect(screen.queryByLabelText('ID client OAuth Google')).toBeNull();
  });
});
