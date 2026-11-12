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
  reprise: {
    total: 42,
    fiches: [{ id: 'x1', nom: 'Jean Fictif', entreprise: 'Fonderie Fictive', fonction: null }],
  },
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
    expect(within(screen.getByRole('region', { name: 'Contactés' })).getByText('105')).toBeTruthy();
    const reponses = screen.getByRole('region', { name: 'Ont répondu' });
    expect(within(reponses).getByText('Personne à cette étape.')).toBeTruthy();
    expect(
      within(screen.getByRole('region', { name: 'RDV accepté' })).getByText('Alice Fictive'),
    ).toBeTruthy();
  });

  it('ouvre la fiche du prospect, avec ses affaires, depuis la colonne RDV accepté', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify(radar)))),
    );
    render(<Radar slug="simatis" />);
    const colonne = await screen.findByRole('region', { name: 'RDV accepté' });
    const carte = within(colonne).getByRole('link', { name: /Alice Fictive/ });
    expect(carte.getAttribute('href')).toBe('#/simatis/fiche/contact/r1');
    // Les fiches de la base vivante n'ont pas de fiche CRM : leurs cartes ne sont pas des liens.
    const prets = screen.getByRole('region', { name: 'Prêts à contacter' });
    expect(within(prets).queryByRole('link', { name: /Paul Dumont/ })).toBeNull();
  });

  it('reprend dans Contactés les affaires du Pipeline sans rendez-vous, avec un lien vers leur fiche', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify(radar)))),
    );
    render(<Radar slug="simatis" />);
    const colonne = await screen.findByRole('region', { name: 'Contactés' });
    expect(within(colonne).getByText(/dont 42 affaires du Pipeline sans rendez-vous/)).toBeTruthy();
    const carte = within(colonne).getByRole('link', { name: /Jean Fictif/ });
    expect(carte.getAttribute('href')).toBe('#/simatis/fiche/contact/x1');
    expect(within(colonne).getByText('Fonderie Fictive · affaire en cours')).toBeTruthy();
    // Les cartes de la base suivent, sans lien.
    expect(within(colonne).getByText('Anne Leroux')).toBeTruthy();
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

  it('offre une action par colonne, qui ouvre le bon écran déjà préparé', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify(radar)))),
    );
    render(<Radar slug="simatis" />);
    const lien = async (colonne: string, nom: string | RegExp) =>
      within(await screen.findByRole('region', { name: colonne }))
        .getByRole('link', { name: nom })
        .getAttribute('href');
    expect(await lien('À enrichir', 'Enrichir les 14')).toBe('#/simatis/bases/ouvrir/a-enrichir');
    expect(await lien('Prêts à contacter', 'Écrire aux 48')).toBe(
      '#/simatis/prospection/ouvrir/froid',
    );
    expect(await lien('Contactés', 'Relancer')).toBe('#/simatis/prospection/ouvrir/froid');
    expect(await lien('Ont répondu', /Répondre/)).toBe('#/simatis/cockpit');
    expect(await lien('RDV accepté', /Pipeline/)).toBe('#/simatis/pipeline');
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
