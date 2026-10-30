// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Partenaires } from './Partenaires.js';

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let ecrituresReelles = true;
let porteuse = true;
let partenaires: unknown[] = [];

const reponse = () => ({
  actif: true,
  porteuse,
  ecrituresReelles,
  inscrit: partenaires.length > 0,
  objets: ['entreprise', 'contact', 'affaire', 'tache', 'rendez_vous', 'activite'],
  champsExcluables: [
    { cle: 'contact.telephone', libelle: 'Téléphone' },
    { cle: 'affaire.montant', libelle: 'Montant' },
  ],
  partenaires,
  missions: [
    {
      id: 'm-1',
      sens: 'envoyee',
      titre: 'Livre blanc (essai)',
      partenaire: 'Alpes OS · Essai',
      etat: 'working',
      dernierMessage: 'Acceptée : « Livre blanc retenu »',
      creeeLe: '2026-10-29T08:00:00Z',
      majLe: '2026-10-29T09:00:00Z',
    },
    {
      id: 'm-2',
      sens: 'recue',
      titre: 'Préparer un atelier (essai)',
      partenaire: 'Alpes OS · Essai',
      etat: 'submitted',
      dernierMessage: null,
      creeeLe: '2026-10-29T10:00:00Z',
      majLe: '2026-10-29T10:00:00Z',
    },
  ],
});

const alpes = {
  id: '00000000-0000-4000-8000-000000000001',
  nom: 'Alpes OS · Essai',
  connecteDepuis: '2026-10-28T08:00:00Z',
  niveau: 'L0',
  voit: {
    objets: ['entreprise', 'contact', 'affaire', 'tache', 'rendez_vous', 'activite'],
    champsExclus: [],
    qualification: false,
  },
  statut: 'active',
  coupeeAt: null,
};

function fakeFetch(url: string, init?: { method?: string; body?: string }) {
  const method = init?.method ?? 'GET';
  const body = init?.body ? (JSON.parse(init.body) as unknown) : undefined;
  calls.push({ url, method, body });
  const json = (b: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(b), { status }));
  if (url.endsWith('/partenaires/rejoindre')) {
    if ((body as { lien: string }).lien.endsWith('BON')) {
      partenaires = [alpes];
      return json({ partenaire: alpes });
    }
    return json({ error: 'invitation inconnue' }, 400);
  }
  if (method === 'PATCH') return json({ partenaire: alpes });
  if (method === 'DELETE') return json({ partenaire: { ...alpes, statut: 'coupee' } });
  return json(reponse());
}

describe('Paramètres > Partenaires', () => {
  beforeEach(() => {
    calls = [];
    ecrituresReelles = true;
    porteuse = true;
    partenaires = [];
    vi.stubGlobal('fetch', vi.fn(fakeFetch));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('connects with a pasted invitation link and shows the partner', async () => {
    render(<Partenaires slug="client-fictif" />);
    fireEvent.change(await screen.findByLabelText(/Lien d'invitation/), {
      target: { value: 'https://relais.test/invitations/BON' },
    });
    fireEvent.click(screen.getByText('Se connecter'));
    expect(await screen.findByText('Alpes OS · Essai')).toBeTruthy();
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({
      url: '/api/i/client-fictif/partenaires/rejoindre',
      body: { lien: 'https://relais.test/invitations/BON' },
    });
    expect(screen.getByText('Connecté')).toBeTruthy();
  });

  it('shows the refusal of the relay', async () => {
    render(<Partenaires slug="client-fictif" />);
    fireEvent.change(await screen.findByLabelText(/Lien d'invitation/), {
      target: { value: 'https://relais.test/invitations/MAUVAIS' },
    });
    fireEvent.click(screen.getByText('Se connecter'));
    expect(await screen.findByText('invitation inconnue')).toBeTruthy();
  });

  it('saves what the partner sees and the level of received missions', async () => {
    partenaires = [alpes];
    render(<Partenaires slug="client-fictif" />);
    fireEvent.click(await screen.findByLabelText('Tâches'));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({
      url: `/api/i/client-fictif/partenaires/${alpes.id}`,
      body: {
        voit: {
          objets: ['entreprise', 'contact', 'affaire', 'rendez_vous', 'activite'],
          champsExclus: [],
          qualification: false,
        },
      },
    });
    fireEvent.click(screen.getByLabelText('Montant'));
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'PATCH').at(-1)?.body).toMatchObject({
        voit: { champsExclus: ['affaire.montant'] },
      }),
    );
    const qualification = screen.getByLabelText<HTMLInputElement>(/Partager la qualification/);
    expect(qualification.checked).toBe(false);
    fireEvent.click(qualification);
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'PATCH').at(-1)?.body).toMatchObject({
        voit: { qualification: true },
      }),
    );
    fireEvent.change(screen.getByLabelText(/Missions reçues de Alpes OS/), {
      target: { value: 'L2' },
    });
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'PATCH').at(-1)?.body).toEqual({ niveau: 'L2' }),
    );
  });

  it('cuts the connection in two clicks', async () => {
    partenaires = [alpes];
    render(<Partenaires slug="client-fictif" />);
    fireEvent.click(await screen.findByText('Couper la connexion'));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    fireEvent.click(screen.getByText('Confirmer : couper la connexion'));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
  });

  it('lists the missions entrusted and received, with their state', async () => {
    render(<Partenaires slug="client-fictif" />);
    expect(await screen.findByText('Livre blanc (essai)')).toBeTruthy();
    expect(screen.getByText('En cours')).toBeTruthy();
    expect(screen.getByText('Préparer un atelier (essai)')).toBeTruthy();
    expect(screen.getByText('De Alpes OS')).toBeTruthy();
    expect(screen.getByText('À Alpes OS')).toBeTruthy();
  });

  it('explains the simulation and sends nothing while real writes are closed', async () => {
    ecrituresReelles = false;
    render(<Partenaires slug="client-fictif" />);
    expect(await screen.findByText(/Écritures réelles désactivées/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Lien d'invitation/), {
      target: { value: 'https://relais.test/invitations/BON' },
    });
    expect(screen.getByText<HTMLButtonElement>('Se connecter').disabled).toBe(true);
  });

  it('sends the pilot to the client’s instance from another one', async () => {
    porteuse = false;
    render(<Partenaires slug="mon-activite" />);
    expect(await screen.findByText(/depuis l'instance de son client/)).toBeTruthy();
  });
});
