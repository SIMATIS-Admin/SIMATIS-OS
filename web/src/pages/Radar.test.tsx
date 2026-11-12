// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EtatRadar } from '../api.js';
import { Radar } from './Radar.js';

const fiche = (id: string, entreprise: string, nom: string) => ({
  id,
  entreprise,
  nom,
  fonction: null,
  nbContacts: 2,
  dernierContactLe: null,
});
const radar: EtatRadar = {
  aEnrichir: { total: 14, fiches: [fiche('a1', 'Atelier Fictif', '')] },
  prets: { total: 48, fiches: [fiche('p1', 'Industrie Fictive', 'Paul Dumont')] },
  contactes: { total: 63, fiches: [fiche('c1', 'Usinage Fictif', 'Anne Leroux')] },
  ontRepondu: { total: 0, fiches: [] },
  rdvAccepte: {
    total: 1,
    fiches: [{ id: 'r1', nom: 'Alice Fictive', entreprise: 'Bureau Fictif', fonction: null }],
  },
};

describe('Radar', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('montre les cinq étapes avec leurs compteurs et leurs premières fiches', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify(radar)))),
    );
    render(<Radar slug="simatis" />);
    const prets = await screen.findByRole('region', { name: 'Prêts à contacter' });
    expect(within(prets).getByText('48')).toBeTruthy();
    expect(within(prets).getByText('Paul Dumont')).toBeTruthy();
    expect(within(prets).getByText('+ 47 autres')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'À enrichir' })).getByText('14')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Contactés' })).getByText('63')).toBeTruthy();
    const reponses = screen.getByRole('region', { name: 'Ont répondu' });
    expect(within(reponses).getByText('Personne à cette étape.')).toBeTruthy();
    expect(
      within(screen.getByRole('region', { name: 'RDV accepté' })).getByText('Alice Fictive'),
    ).toBeTruthy();
  });

  it('garde les écrans Prospection et Bases vivantes accessibles', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify(radar)))),
    );
    render(<Radar slug="simatis" />);
    await screen.findByRole('region', { name: 'Contactés' });
    expect(screen.getByRole('link', { name: 'Trouver des suspects' }).getAttribute('href')).toBe(
      '#/simatis/bases',
    );
    expect(screen.getByRole('link', { name: 'Campagnes et envois' }).getAttribute('href')).toBe(
      '#/simatis/prospection',
    );
  });

  it("explique l'échec de chargement", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('boom', { status: 500 }))),
    );
    render(<Radar slug="simatis" />);
    expect(await screen.findByText(/500|boom|Erreur/i)).toBeTruthy();
  });
});
