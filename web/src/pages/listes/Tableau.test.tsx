// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Tableau, type Colonne } from './Tableau.js';

type Ligne = { id: string; nom: string; ville: string | null; salaries: number | null };
const lignes: Ligne[] = [
  { id: 'e1', nom: 'Fonderie Vallière', ville: 'Lyon', salaries: 48 },
  { id: 'e2', nom: 'Menuiserie Arpin', ville: 'Albertville', salaries: 17 },
  { id: 'e3', nom: 'Transports Dalmas', ville: 'Lyon', salaries: 120 },
];
const colonnes: Colonne<Ligne>[] = [
  { cle: 'nom', label: 'Nom', valeur: (l) => l.nom },
  { cle: 'ville', label: 'Ville', valeur: (l) => l.ville, edition: { champ: 'ville' } },
  {
    cle: 'salaries',
    label: 'Salariés',
    valeur: (l) => l.salaries,
    edition: { champ: 'taille', type: 'number' },
  },
];

const noms = () =>
  [...document.querySelectorAll('tbody tr td.tb-nom')].map((td) => td.textContent ?? '');
let modifier = vi.fn(() => Promise.resolve());
const afficher = () =>
  render(
    <Tableau
      cle="test"
      lignes={lignes}
      colonnes={colonnes}
      titre={(l) => l.nom}
      onOuvrir={() => undefined}
      onModifier={modifier}
    />,
  );

describe('Tableau (liste à la Pipedrive)', () => {
  beforeEach(() => {
    localStorage.clear();
    modifier = vi.fn(() => Promise.resolve());
  });
  afterEach(cleanup);

  it('hides a column from the column chooser, and remembers it', () => {
    afficher();
    fireEvent.click(screen.getByRole('button', { name: 'Colonnes' }));
    fireEvent.click(screen.getByLabelText('Afficher la colonne Salariés'));
    expect(screen.queryByRole('columnheader', { name: /Salariés/ })).toBeNull();
    cleanup();
    afficher();
    expect(screen.queryByRole('columnheader', { name: /Salariés/ })).toBeNull();
  });

  it('sorts by a column, ascending then descending', () => {
    afficher();
    fireEvent.click(screen.getByRole('button', { name: 'Trier par Salariés' }));
    expect(noms()).toEqual(['Menuiserie Arpin', 'Fonderie Vallière', 'Transports Dalmas']);
    fireEvent.click(screen.getByRole('button', { name: 'Trier par Salariés' }));
    expect(noms()).toEqual(['Transports Dalmas', 'Fonderie Vallière', 'Menuiserie Arpin']);
  });

  it('filters on a field, saves the filter by name and reuses it', () => {
    afficher();
    fireEvent.change(screen.getByLabelText('Champ du filtre'), { target: { value: 'ville' } });
    fireEvent.change(screen.getByLabelText('Valeur du filtre'), { target: { value: 'lyon' } });
    expect(noms()).toEqual(['Fonderie Vallière', 'Transports Dalmas']);
    fireEvent.change(screen.getByLabelText('Nom du filtre'), { target: { value: 'Lyonnais' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le filtre' }));
    cleanup();
    afficher();
    expect(noms()).toHaveLength(3);
    fireEvent.change(screen.getByLabelText('Filtres enregistrés'), {
      target: { value: 'Lyonnais' },
    });
    expect(noms()).toEqual(['Fonderie Vallière', 'Transports Dalmas']);
  });

  it('edits a cell in place with the pencil', async () => {
    afficher();
    fireEvent.click(screen.getByRole('button', { name: 'Modifier Ville de Menuiserie Arpin' }));
    const champ = screen.getByLabelText('Ville de Menuiserie Arpin');
    fireEvent.change(champ, { target: { value: 'Annecy' } });
    fireEvent.keyDown(champ, { key: 'Enter' });
    await waitFor(() => expect(modifier).toHaveBeenCalled());
    expect(modifier).toHaveBeenCalledWith(lignes[1], 'ville', 'Annecy');
  });

  it('edits several selected rows at once', async () => {
    afficher();
    fireEvent.click(screen.getByLabelText('Sélectionner Fonderie Vallière'));
    fireEvent.click(screen.getByLabelText('Sélectionner Transports Dalmas'));
    const barre = screen.getByRole('region', { name: '2 sélectionnées' });
    fireEvent.change(within(barre).getByLabelText('Champ à modifier'), {
      target: { value: 'taille' },
    });
    fireEvent.change(within(barre).getByLabelText('Nouvelle valeur'), { target: { value: '50' } });
    fireEvent.click(within(barre).getByRole('button', { name: 'Appliquer' }));
    await waitFor(() => expect(modifier).toHaveBeenCalledTimes(2));
    expect(modifier).toHaveBeenCalledWith(lignes[0], 'taille', 50);
    expect(modifier).toHaveBeenCalledWith(lignes[2], 'taille', 50);
  });
});
