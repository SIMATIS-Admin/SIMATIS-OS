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

  describe('suppression et fusion', () => {
    const afficherAvec = (
      onSupprimer?: Parameters<typeof Tableau<Ligne>>[0]['onSupprimer'],
      onFusionner?: Parameters<typeof Tableau<Ligne>>[0]['onFusionner'],
    ) =>
      render(
        <Tableau
          cle="test"
          lignes={lignes}
          colonnes={colonnes}
          titre={(l) => l.nom}
          onOuvrir={() => undefined}
          onModifier={modifier}
          onSupprimer={onSupprimer}
          onFusionner={onFusionner}
        />,
      );
    const cocher = (...noms: string[]) =>
      noms.forEach((n) => fireEvent.click(screen.getByLabelText(`Sélectionner ${n}`)));

    it('n’offre ni suppression ni fusion sans les actions', () => {
      afficher();
      cocher('Fonderie Vallière');
      expect(screen.queryByRole('button', { name: 'Supprimer la sélection' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Fusionner' })).toBeNull();
    });

    it('demande confirmation, supprime la sélection et affiche le bilan', async () => {
      const onSupprimer = vi.fn(() =>
        Promise.resolve({
          ok: 1,
          erreurs: [{ id: 'e3', erreur: 'Cette affaire a un devis' }],
          simulation: false,
        }),
      );
      afficherAvec(onSupprimer);
      cocher('Fonderie Vallière', 'Transports Dalmas');
      fireEvent.click(screen.getByRole('button', { name: 'Supprimer la sélection' }));
      expect(screen.getByRole('dialog', { name: 'Supprimer 2 fiches ?' })).toBeTruthy();
      expect(onSupprimer).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Confirmer la suppression' }));
      await waitFor(() => expect(onSupprimer).toHaveBeenCalledWith(['e1', 'e3']));
      const bilan = await screen.findByRole('status');
      expect(bilan.textContent).toContain('1 supprimée');
      expect(bilan.textContent).toContain('Transports Dalmas (Cette affaire a un devis)');
      expect(screen.queryByRole('region', { name: /sélectionnées/ })).toBeNull();
    });

    it('annuler la confirmation ne supprime rien', () => {
      const onSupprimer = vi.fn();
      afficherAvec(onSupprimer);
      cocher('Fonderie Vallière');
      fireEvent.click(screen.getByRole('button', { name: 'Supprimer la sélection' }));
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Annuler' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(onSupprimer).not.toHaveBeenCalled();
    });

    it('annonce la simulation sans prétendre avoir supprimé', async () => {
      afficherAvec(() => Promise.resolve({ ok: 0, erreurs: [], simulation: true }));
      cocher('Fonderie Vallière');
      fireEvent.click(screen.getByRole('button', { name: 'Supprimer la sélection' }));
      fireEvent.click(screen.getByRole('button', { name: 'Confirmer la suppression' }));
      expect((await screen.findByRole('status')).textContent).toContain('Simulation');
    });

    it('ne propose la fusion que pour exactement deux fiches, et demande laquelle garder', async () => {
      const onFusionner = vi.fn(() => Promise.resolve());
      afficherAvec(undefined, onFusionner);
      cocher('Fonderie Vallière');
      const bouton = screen.getByRole('button', { name: 'Fusionner' });
      expect((bouton as HTMLButtonElement).disabled).toBe(true);
      cocher('Menuiserie Arpin');
      expect((bouton as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(bouton);
      const confirmer = screen.getByRole('button', { name: 'Confirmer la fusion' });
      expect((confirmer as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByRole('dialog').textContent).toContain('définitive dans HubSpot');
      fireEvent.click(screen.getByLabelText('Menuiserie Arpin'));
      fireEvent.click(confirmer);
      await waitFor(() => expect(onFusionner).toHaveBeenCalledWith('e2', 'e1'));
      expect((await screen.findByRole('status')).textContent).toContain('fusionnées');
    });
  });
});
