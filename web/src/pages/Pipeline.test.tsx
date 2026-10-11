// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pipeline } from './Pipeline.js';

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let lectureSeule = false;

const opp = (id: string, etape: string, extra: Record<string, unknown> = {}) => ({
  id,
  titre: `Affaire ${id}`,
  etape,
  clos: null,
  motif: null,
  montant: 10000,
  echeance: null,
  qualification: { besoin: 3, decideur: 3, budget: 2, timing: 3, engagement: 2 },
  potentiel: 'eleve',
  faisabilite: 'forte',
  prochaineEtape: 'Relancer',
  entreprise: `Entreprise ${id}`,
  contact: null,
  derniereActivite: null,
  prochaine: null,
  joursInactif: null,
  ...extra,
});

const pipeline = () => ({
  source: lectureSeule ? 'hubspot' : 'natif',
  ecrit: !lectureSeule,
  derniereSynchro: lectureSeule ? new Date().toISOString() : null,
  etapes: [
    { id: 'qualification', label: 'Qualification' },
    { id: 'proposition', label: 'Proposition' },
  ],
  conversions: [83, null],
  inactiviteJours: 14,
  opportunites: [
    opp('o1', 'qualification', {
      prochaine: { echeance: '2026-10-16T08:00:00.000Z', enRetard: false },
      joursInactif: 2,
    }),
    opp('o2', 'proposition', { joursInactif: 20 }),
    opp('o4', 'proposition', {
      prochaine: { echeance: '2026-10-10T08:00:00.000Z', enRetard: true },
      joursInactif: 5,
    }),
    opp('o3', 'proposition', { clos: 'perdu', motif: 'Budget reporté' }),
  ],
});

function fakeFetch(url: string, init?: { method?: string; body?: string }) {
  const method = init?.method ?? 'GET';
  calls.push({ url, method, body: init?.body ? (JSON.parse(init.body) as unknown) : undefined });
  const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body)));
  if (method === 'PATCH') return json({ opportunite: opp('o1', 'proposition'), simulation: false });
  return json(pipeline());
}

const dataTransfer = (id: string) => ({
  types: ['application/x-simatis-opp'],
  getData: () => id,
  setData: () => undefined,
});

describe('Pipeline screen', () => {
  beforeEach(() => {
    calls = [];
    lectureSeule = false;
    vi.stubGlobal('fetch', vi.fn(fakeFetch));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows stage columns, closed columns and the conversion rate between stages', async () => {
    render(<Pipeline slug="simatis" />);
    expect(await screen.findByText('Entreprise o1')).toBeTruthy();
    expect(screen.getByText('Gagnées')).toBeTruthy();
    expect(screen.getByLabelText('Qualification vers Proposition : 83 %')).toBeTruthy();
    expect(screen.getByText(/Perdue en proposition : budget reporté/)).toBeTruthy();
  });

  it('moves a card to another stage by drag and drop', async () => {
    const { container } = render(<Pipeline slug="simatis" />);
    await screen.findByText('Entreprise o1');
    const proposition = [...container.querySelectorAll('.col')].find((c) =>
      c.textContent?.startsWith('Proposition'),
    );
    if (!proposition) throw new Error('column missing');
    fireEvent.dragOver(proposition, { dataTransfer: dataTransfer('o1') });
    fireEvent.drop(proposition, { dataTransfer: dataTransfer('o1') });
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({
      url: '/api/i/simatis/opportunites/o1',
      body: { etape: 'proposition' },
    });
    expect(screen.queryByText(/les cartes ne se déplacent pas/)).toBeNull();
  });

  it('asks for the reason before closing a deal as lost', async () => {
    const { container } = render(<Pipeline slug="simatis" />);
    await screen.findByText('Entreprise o1');
    const perdues = container.querySelector('.col.lost');
    if (!perdues) throw new Error('column missing');
    fireEvent.drop(perdues, { dataTransfer: dataTransfer('o1') });
    const modal = await screen.findByRole('dialog');
    fireEvent.change(within(modal).getByLabelText('Motif'), {
      target: { value: 'Projet abandonné' },
    });
    fireEvent.click(within(modal).getByText('Clôturer'));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      clos: 'perdu',
      motif: 'Projet abandonné',
    });
  });

  it('shows a read-only HubSpot mirror without drag and drop', async () => {
    lectureSeule = true;
    const { container } = render(<Pipeline slug="helioval" />);
    expect(await screen.findByText(/Miroir HubSpot/)).toBeTruthy();
    expect(container.querySelector('.card')?.getAttribute('draggable')).toBe('false');
    expect(screen.getByText(/lecture seule : les cartes ne se déplacent pas/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Paramètres/ }).getAttribute('href')).toBe(
      '#/helioval/parametres',
    );
  });

  it('shows the activity state of each open deal and flags inactive ones', async () => {
    const { container } = render(<Pipeline slug="simatis" />);
    await screen.findByText('Entreprise o1');
    const carte = (id: string) =>
      screen.getByText(`Entreprise ${id}`).closest('.card') as HTMLElement;
    expect(within(carte('o1')).getByLabelText(/^Prochaine activité le /)).toBeTruthy();
    expect(within(carte('o4')).getByLabelText('Activité en retard')).toBeTruthy();
    expect(within(carte('o2')).getByLabelText('Aucune activité prévue')).toBeTruthy();
    expect(carte('o2').classList.contains('inactive')).toBe(true);
    expect(within(carte('o2')).getByText('20 j sans activité')).toBeTruthy();
    expect(carte('o1').classList.contains('inactive')).toBe(false);
    const close = [...container.querySelectorAll('.card')].find((c) =>
      c.textContent?.includes('Entreprise o3'),
    );
    expect(close?.querySelector('.act')).toBeNull();
  });

  it('saves the inactivity threshold from the pipeline', async () => {
    render(<Pipeline slug="simatis" />);
    await screen.findByText('Entreprise o1');
    const champ = screen.getByLabelText('Inactive après (jours)');
    fireEvent.change(champ, { target: { value: '21' } });
    fireEvent.blur(champ);
    await waitFor(() =>
      expect(calls.find((c) => c.url.endsWith('/pipeline/reglages'))).toMatchObject({
        method: 'PATCH',
        body: { inactiviteJours: 21 },
      }),
    );
  });
});
