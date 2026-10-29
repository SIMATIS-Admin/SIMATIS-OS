// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Cerveau } from './Cerveau.js';

const carte = {
  noeuds: [
    { id: 'index.md', titre: 'Accueil fictif', categorie: 'racine', statut: null },
    {
      id: 'brain/clients/acme.md',
      titre: 'Acme fictive',
      categorie: 'clients',
      statut: 'verified',
    },
    { id: 'brain/mandats/projet.md', titre: 'Projet fictif', categorie: 'mandats', statut: null },
  ],
  liens: [
    { de: 'index.md', vers: 'brain/clients/acme.md' },
    { de: 'brain/clients/acme.md', vers: 'brain/mandats/projet.md' },
  ],
  autresFichiers: 4,
  tronquee: false,
  misAJour: '2026-10-29T10:00:00Z',
};

const repondre = (corps: unknown, status = 200) =>
  vi.stubGlobal('fetch', () => Promise.resolve(new Response(JSON.stringify(corps), { status })));

beforeEach(() => repondre(carte));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Cerveau', () => {
  it('affiche les notes, la légende avec les effectifs et le total', async () => {
    render(<Cerveau slug="x" />);
    await waitFor(() => expect(screen.getByLabelText('Légende')).toBeTruthy());
    const legende = screen.getByLabelText('Légende');
    expect(legende.textContent).toContain('Clients');
    expect(legende.textContent).toContain('Mandats');
    expect(screen.getByText(/3 notes, 2 liens, 4 autres fichiers/)).toBeTruthy();
    expect(screen.getByTestId('noeud-index.md')).toBeTruthy();
  });

  it('un clic sur une note montre ses liens, un clic sur un lien navigue', async () => {
    render(<Cerveau slug="x" />);
    fireEvent.click(await screen.findByTestId('noeud-brain/clients/acme.md'));
    expect(screen.getByText('Cité par')).toBeTruthy();
    expect(screen.getByText('Renvoie vers')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Projet fictif' }));
    expect(screen.getByText('brain/mandats/projet.md')).toBeTruthy();
  });

  it('la légende masque une catégorie', async () => {
    render(<Cerveau slug="x" />);
    await screen.findByLabelText('Légende');
    fireEvent.click(screen.getByRole('button', { name: /Clients/ }));
    expect(screen.queryByTestId('noeud-brain/clients/acme.md')).toBeNull();
    expect(screen.getByTestId('noeud-index.md')).toBeTruthy();
  });

  it('explique quand la carte n’est pas encore arrivée', async () => {
    repondre(null);
    render(<Cerveau slug="x" />);
    expect(await screen.findByText(/pas encore arrivée/)).toBeTruthy();
  });

  it('affiche le refus du serveur', async () => {
    repondre({ error: "Le second cerveau n'est pas activé dans cet espace." }, 403);
    render(<Cerveau slug="x" />);
    expect(await screen.findByText(/pas activé/)).toBeTruthy();
  });
});
