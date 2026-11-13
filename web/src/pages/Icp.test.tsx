// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CiblageAtelier } from '../api.js';

const api = vi.hoisted(() => ({ fetchCiblages: vi.fn() }));
vi.mock('../api.js', () => api);

import { Icp } from './Icp.js';

const icp = (
  code: string,
  nom: string,
  atelierId = 'a1',
  entreprise = 'Entreprise fictive',
): CiblageAtelier => ({
  atelierId,
  atelierTitre: 'Atelier fictif',
  entreprise,
  code,
  nom,
  offre: 'Offre fictive',
  icp: [
    { cle: 'Catégorie', valeur: 'PME industrielles' },
    { cle: 'Localisation', valeur: '' },
  ],
  persona: [{ cle: 'Poste', valeur: 'Dirigeant' }],
  demande: 'demande',
});

describe('Icp', () => {
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it("montre une carte par ICP de l'instance, sans les champs vides", async () => {
    api.fetchCiblages.mockResolvedValue([
      icp('ICP A', 'Industrie'),
      icp('ICP B', 'Services', 'a2'),
    ]);
    render(<Icp slug="demo" nom="Démo" />);
    const carte = await screen.findByRole('article', { name: 'ICP A' });
    expect(within(carte).getByText(/PME industrielles/)).toBeTruthy();
    expect(within(carte).getByText('Dirigeant')).toBeTruthy();
    expect(within(carte).queryByText('Localisation')).toBeNull();
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.getByText(/2 ICP pour Entreprise fictive/)).toBeTruthy();
    // Un seul choix d'entreprise : pas de sélecteur.
    expect(screen.queryByRole('group', { name: 'Entreprise' })).toBeNull();
    expect(api.fetchCiblages).toHaveBeenCalledWith('demo');
  });

  it("choisit l'entreprise et ne montre que ses ICP quand l'instance en porte plusieurs", async () => {
    api.fetchCiblages.mockResolvedValue([
      icp('ICP A', 'Industrie', 'a1', 'Entreprise fictive'),
      icp('ICP A', 'Services', 'a2', 'Autre entreprise fictive'),
      icp('ICP B', 'Négoce', 'a2', 'Autre entreprise fictive'),
    ]);
    render(<Icp slug="demo" nom="Démo" />);
    const choix = await screen.findByRole('group', { name: 'Entreprise' });
    expect(screen.getAllByRole('article')).toHaveLength(1);
    fireEvent.click(within(choix).getByRole('button', { name: 'Autre entreprise fictive' }));
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.queryByText(/Industrie/)).toBeNull();
    expect(screen.getByText(/2 ICP pour Autre entreprise fictive/)).toBeTruthy();
  });

  it("renvoie vers la recherche préréglée et vers l'Atelier de cet ICP", async () => {
    api.fetchCiblages.mockResolvedValue([icp('ICP A', 'Industrie')]);
    render(<Icp slug="demo" nom="Démo" />);
    const carte = await screen.findByRole('article', { name: 'ICP A' });
    expect(
      within(carte).getByRole('link', { name: 'Chercher selon cet ICP' }).getAttribute('href'),
    ).toBe(`#/demo/recherches/ouvrir/${encodeURIComponent('a1~ICP A')}`);
    expect(
      within(carte).getByRole('link', { name: 'Modifier dans l’Atelier' }).getAttribute('href'),
    ).toBe('#/demo/atelier/ouvrir/a1');
  });

  it("invite à ouvrir l'Atelier quand l'instance n'a aucun ICP, ou pas d'Atelier", async () => {
    api.fetchCiblages.mockResolvedValue([]);
    const { unmount } = render(<Icp slug="demo" nom="Démo" />);
    expect(await screen.findByText(/Aucun ICP pour Démo/)).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Ouvrir l’Atelier stratégique' }).getAttribute('href'),
    ).toBe('#/demo/atelier');
    unmount();
    api.fetchCiblages.mockRejectedValue(new Error('pas de module'));
    render(<Icp slug="demo" nom="Démo" />);
    expect(await screen.findByText(/Aucun ICP pour Démo/)).toBeTruthy();
  });
});
