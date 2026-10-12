// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Connexions } from './Connexions.js';

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let tokenPresent = true;
let avecGoogle = false;
let clientDisponible = true;
let avecInfomaniak = false;
let degrade = false;

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
      degrade,
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
    ...(avecInfomaniak
      ? [
          {
            kind: 'messagerie',
            fournisseur: 'infomaniak',
            etat: 'ok',
            reglages: { historiqueMois: 12, contenu: 'extraits' },
            derniereSynchro: null,
            derniereErreur: null,
            secret: { nom: 'IMAP_PASSWORD', present: true },
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
  if (url.endsWith('/connexions/infomaniak')) {
    const ok = (calls.at(-1)?.body as { motDePasse: string }).motDePasse === 'bon-fictif';
    if (ok) avecInfomaniak = true;
    return Promise.resolve(
      new Response(
        JSON.stringify(ok ? { ok: true } : { error: 'La boîte mail refuse ce mot de passe' }),
        { status: ok ? 200 : 400 },
      ),
    );
  }
  if (url === '/api/google/secret') return json({ ok: true });
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
    avecInfomaniak = false;
    degrade = false;
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

  it('saves the email domains to leave out, one per line', async () => {
    render(<Connexions slug="helioval" />);
    const zone = await screen.findByLabelText(/Domaines à écarter/);
    fireEvent.change(zone, {
      target: { value: 'banque-fictive.example\n\n  comptable-fictif.example ' },
    });
    fireEvent.click(screen.getByText('Enregistrer les domaines'));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({
      url: '/api/i/helioval/connexions/crm',
      body: { domainesExclus: ['banque-fictive.example', 'comptable-fictif.example'] },
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

  it('connects HubSpot in degraded mode with a personal access key', async () => {
    tokenPresent = false;
    render(<Connexions slug="helioval" />);
    fireEvent.click(await screen.findByLabelText(/Connexion en mode dégradé/));
    const input = screen.getByPlaceholderText('Clé personnelle…');
    fireEvent.change(input, { target: { value: 'cle-fictive-0000' } });
    fireEvent.click(screen.getByText('Vérifier et brancher HubSpot'));
    await waitFor(() =>
      expect(calls.find((c) => c.url.endsWith('/connexions/hubspot'))).toMatchObject({
        body: { token: 'cle-fictive-0000', mode: 'degrade' },
      }),
    );
  });

  it('flags a degraded-mode connection and lets the access be replaced', async () => {
    degrade = true;
    render(<Connexions slug="helioval" />);
    expect(await screen.findByText(/passe par votre clé personnelle/)).toBeTruthy();
    expect(screen.queryByPlaceholderText('pat-eu1-…')).toBeNull();
    fireEvent.click(screen.getByText('Changer le jeton ou la clé HubSpot'));
    expect(screen.getByPlaceholderText('pat-eu1-…')).toBeTruthy();
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

  it('asks once for the OS Google secret, then offers the Google button', async () => {
    clientDisponible = false;
    render(<Connexions slug="helioval" />);
    const input = await screen.findByPlaceholderText('GOCSPX-…');
    expect(screen.queryByText('Connecter le compte Google')).toBeNull();
    fireEvent.change(input, { target: { value: 'GOCSPX-fictif-0000' } });
    clientDisponible = true;
    fireEvent.click(screen.getByText('Enregistrer'));
    expect(await screen.findByText('Connecter le compte Google')).toBeTruthy();
    expect(calls.find((c) => c.url === '/api/google/secret')).toMatchObject({
      method: 'PUT',
      body: { secret: 'GOCSPX-fictif-0000' },
    });
  });

  it('connects an Infomaniak mailbox, shows a refusal, then offers Google for the agenda', async () => {
    render(<Connexions slug="helioval" />);
    const adresse = await screen.findByPlaceholderText('prenom@exemple.fr');
    const motDePasse = screen.getByLabelText(/Mot de passe d'appareil/);
    const bouton = screen.getByText<HTMLButtonElement>('Vérifier et brancher la boîte Infomaniak');
    expect(bouton.disabled).toBe(true);
    fireEvent.change(adresse, { target: { value: 'marc@pilote.example' } });
    fireEvent.change(motDePasse, { target: { value: 'faux' } });
    fireEvent.click(bouton);
    expect(await screen.findByText(/refuse ce mot de passe/)).toBeTruthy();

    fireEvent.change(motDePasse, { target: { value: 'bon-fictif' } });
    fireEvent.click(bouton);
    expect(await screen.findByText('Infomaniak')).toBeTruthy();
    expect(calls.filter((c) => c.url.endsWith('/connexions/infomaniak')).at(-1)).toMatchObject({
      method: 'POST',
      body: { email: 'marc@pilote.example', motDePasse: 'bon-fictif' },
    });
    expect(screen.getByText(/vous envoyez depuis votre messagerie Infomaniak/)).toBeTruthy();
    expect(screen.getByText(/l'agenda se branche à part/)).toBeTruthy();
    expect(screen.getByText('Connecter le compte Google')).toBeTruthy();
  });
});
