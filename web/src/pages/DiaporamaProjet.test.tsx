// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiaporamaProjet, lignesDe } from './DiaporamaProjet.js';

const api = vi.hoisted(() => ({
  fetchDiapositivesRestitution: vi.fn(),
  fetchProjetsDiag: vi.fn(),
}));
vi.mock('../api.js', () => api);

beforeEach(() => {
  api.fetchDiapositivesRestitution.mockReset();
  api.fetchProjetsDiag.mockReset();
});
afterEach(cleanup);

const DIAPOS = [
  { titre: 'Votre diagnostic', texte: 'Restitution du 12 mars', notes: 'Accueillir, 2 minutes' },
  {
    titre: 'Les priorités',
    texte: '- Relancer les devis\n• Créer un fichier\nSuivre chaque semaine',
    notes: '',
  },
];

describe('lignesDe', () => {
  it('efface les puces d’origine et les lignes vides', () => {
    expect(lignesDe('- Un\n\n• Deux\n  Trois  ')).toEqual(['Un', 'Deux', 'Trois']);
  });
});

describe('Diaporama d’une restitution', () => {
  it('présente le titre puis les puces, et rend les notes à l’orateur', async () => {
    api.fetchDiapositivesRestitution.mockResolvedValue({
      nom: 'Entreprise Fictive A',
      diapositives: DIAPOS,
    });
    render(<DiaporamaProjet slug="demo" genre="restitution" id="p1" />);
    expect(await screen.findByRole('heading', { name: 'Votre diagnostic' })).toBeTruthy();
    expect(screen.getByText('Entreprise Fictive A')).toBeTruthy();
    expect(screen.getByText('Accueillir, 2 minutes')).toBeTruthy();
    expect(api.fetchDiapositivesRestitution).toHaveBeenCalledWith('demo', 'p1');
    fireEvent.click(screen.getByRole('button', { name: 'Slide suivante' }));
    expect(screen.getByRole('heading', { name: 'Les priorités' })).toBeTruthy();
    expect(screen.getAllByRole('listitem').map((l) => l.textContent)).toEqual([
      'Relancer les devis',
      'Créer un fichier',
      'Suivre chaque semaine',
    ]);
  });

  it('propose de retourner au diagnostic', async () => {
    api.fetchDiapositivesRestitution.mockResolvedValue({ nom: 'X', diapositives: DIAPOS });
    render(<DiaporamaProjet slug="demo" genre="restitution" id="p1" />);
    const retour = await screen.findByRole('link', { name: '← Retour au diagnostic' });
    expect(retour.getAttribute('href')).toBe('#/demo/diagnostics/ouvrir/p1');
  });

  it('dit pourquoi il n’y a rien à présenter', async () => {
    api.fetchDiapositivesRestitution.mockRejectedValue(
      new Error("Aucune diapositive n'a encore été exportée"),
    );
    render(<DiaporamaProjet slug="demo" genre="restitution" id="p1" />);
    expect(await screen.findByText(/Aucune diapositive/)).toBeTruthy();
  });
});

describe('Diaporama d’un support d’ouverture', () => {
  it('lit le texte gardé dans le projet', async () => {
    api.fetchProjetsDiag.mockResolvedValue([
      { id: 'p1', nom: 'Entreprise Fictive B', supportTexte: DIAPOS },
    ]);
    render(<DiaporamaProjet slug="demo" genre="support" id="p1" />);
    expect(await screen.findByRole('heading', { name: 'Votre diagnostic' })).toBeTruthy();
    expect(api.fetchProjetsDiag).toHaveBeenCalledWith('demo');
  });

  it('refuse un support sans diapositives', async () => {
    api.fetchProjetsDiag.mockResolvedValue([{ id: 'p1', nom: 'X', supportTexte: null }]);
    render(<DiaporamaProjet slug="demo" genre="support" id="p1" />);
    expect(await screen.findByText(/pas encore de diapositives/)).toBeTruthy();
  });
});
