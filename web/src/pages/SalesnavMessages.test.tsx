// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VueSalesnav } from '../api.js';

const api = vi.hoisted(() => ({
  fetchSalesnav: vi.fn(),
  fetchCiblages: vi.fn(),
  enregistrerModeleSalesnav: vi.fn(),
  creerCampagneSalesnav: vi.fn(),
  supprimerCampagneSalesnav: vi.fn(),
  enregistrerSurchargeSalesnav: vi.fn(),
  retirerSurchargeSalesnav: vi.fn(),
}));
vi.mock('../api.js', () => api);

import { SalesnavMessages } from './SalesnavMessages.js';

// Textes fictifs : les vrais messages se saisissent dans l'OS, jamais dans le dépôt.
const vue = (surcharge = false): VueSalesnav => ({
  etapes: ['invitation', 'acceptation', 'relance1', 'relance2'],
  limiteInvitation: 300,
  modeles: [{ icp: 'Cible fictive', etape: 'relance1', texte: 'Relance du modèle' }],
  campagnes: [
    {
      id: 'c1',
      nom: 'Lot fictif',
      icp: 'Cible fictive',
      surcharges: surcharge ? [{ etape: 'relance1', texte: 'Relance du lot' }] : [],
    },
  ],
});

describe('SalesnavMessages', () => {
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  const monter = async (v = vue()) => {
    api.fetchSalesnav.mockResolvedValue(v);
    api.fetchCiblages.mockResolvedValue([]);
    render(<SalesnavMessages slug="demo" />);
    await screen.findByText('Modèles par défaut');
  };

  it('enregistre le modèle par défaut de la cible choisie', async () => {
    await monter();
    fireEvent.change(screen.getByLabelText('Cible'), { target: { value: 'Cible fictive' } });
    const champ = (await screen.findAllByRole('textbox')).find(
      (t) => (t as HTMLTextAreaElement).value === 'Relance du modèle',
    )!;
    fireEvent.change(champ, { target: { value: 'Relance modifiée' } });
    const bouton = within(champ.closest('.salesnav-champ') as HTMLElement).getByRole('button', {
      name: 'Enregistrer le modèle',
    });
    fireEvent.click(bouton);
    await waitFor(() =>
      expect(api.enregistrerModeleSalesnav).toHaveBeenCalledWith(
        'demo',
        'Cible fictive',
        'relance1',
        'Relance modifiée',
      ),
    );
  });

  it("compte les caractères de la note d'invitation et bloque au-delà de 300", async () => {
    await monter();
    fireEvent.change(screen.getByLabelText('Cible'), { target: { value: 'Cible fictive' } });
    const champs = await screen.findAllByRole('textbox');
    const note = champs.find((t) =>
      t.closest('.salesnav-champ')?.textContent?.includes('Note d’invitation'),
    )!;
    fireEvent.change(note, { target: { value: 'x'.repeat(301) } });
    expect(screen.getByText('301 / 300 caractères')).toBeTruthy();
    const bouton = within(
      note.closest('.salesnav-champ') as HTMLElement,
    ).getByRole<HTMLButtonElement>('button', { name: 'Enregistrer le modèle' });
    expect(bouton.disabled).toBe(true);
    fireEvent.change(note, { target: { value: 'x'.repeat(300) } });
    expect(bouton.disabled).toBe(false);
  });

  it('modifie un message pour une campagne seulement', async () => {
    await monter();
    fireEvent.click(screen.getByRole('button', { name: 'Modifier les messages' }));
    const carte = screen.getByRole('article', { name: 'Lot fictif' });
    const champ = within(carte)
      .getAllByRole('textbox')
      .find((t) => (t as HTMLTextAreaElement).value === 'Relance du modèle')!;
    expect(
      within(champ.closest('.salesnav-champ') as HTMLElement).getByText('Modèle par défaut'),
    ).toBeTruthy();
    fireEvent.change(champ, { target: { value: 'Relance du lot' } });
    fireEvent.click(
      within(champ.closest('.salesnav-champ') as HTMLElement).getByRole('button', {
        name: 'Enregistrer pour cette campagne',
      }),
    );
    await waitFor(() =>
      expect(api.enregistrerSurchargeSalesnav).toHaveBeenCalledWith(
        'demo',
        'c1',
        'relance1',
        'Relance du lot',
      ),
    );
    expect(api.enregistrerModeleSalesnav).not.toHaveBeenCalled();
  });

  it('remet le modèle quand la campagne a son propre texte', async () => {
    await monter(vue(true));
    fireEvent.click(screen.getByRole('button', { name: 'Modifier les messages' }));
    const carte = screen.getByRole('article', { name: 'Lot fictif' });
    expect(within(carte).getByText('Propre à la campagne')).toBeTruthy();
    fireEvent.click(within(carte).getByRole('button', { name: 'Remettre le modèle' }));
    await waitFor(() =>
      expect(api.retirerSurchargeSalesnav).toHaveBeenCalledWith('demo', 'c1', 'relance1'),
    );
  });

  it('crée une campagne avec un nom et une cible', async () => {
    await monter();
    api.creerCampagneSalesnav.mockResolvedValue({
      id: 'c2',
      nom: 'Autre lot',
      icp: 'Cible fictive',
    });
    fireEvent.change(screen.getByLabelText('Nom de la campagne'), {
      target: { value: 'Autre lot' },
    });
    fireEvent.change(screen.getByLabelText('Cible de la campagne'), {
      target: { value: 'Cible fictive' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Créer la campagne' }));
    await waitFor(() =>
      expect(api.creerCampagneSalesnav).toHaveBeenCalledWith('demo', 'Autre lot', 'Cible fictive'),
    );
  });

  it("affiche l'erreur de l'API quand l'enregistrement échoue", async () => {
    await monter();
    api.enregistrerModeleSalesnav.mockRejectedValue(new Error('Le message est vide.'));
    fireEvent.change(screen.getByLabelText('Cible'), { target: { value: 'Cible fictive' } });
    const champs = await screen.findAllByRole('textbox');
    const champ = champs.find((t) => (t as HTMLTextAreaElement).value === 'Relance du modèle')!;
    fireEvent.change(champ, { target: { value: 'Autre texte' } });
    fireEvent.click(
      within(champ.closest('.salesnav-champ') as HTMLElement).getByRole('button', {
        name: 'Enregistrer le modèle',
      }),
    );
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Le message est vide.')).toBeTruthy();
  });
});
