// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  fetchPipeline: vi.fn(),
  fetchTaches: vi.fn(),
  updateTache: vi.fn(),
  createTache: vi.fn(),
}));
vi.mock('../api.js', () => api);

import { AideRelance } from './AideRelance.js';

const opp = (id: number, extra: Record<string, unknown> = {}) => ({
  id: `o${id}`,
  titre: `Affaire ${id}`,
  etape: 'proposition',
  clos: null,
  montant: null,
  entreprise: `Société fictive ${id}`,
  contact: 'Camille Exemple',
  derniereActivite: null,
  joursInactif: 30 + id,
  radar: null,
  tentatives: 0,
  radarEtapeManuelle: null,
  ...extra,
});

const tacheRetard = {
  id: 't1',
  titre: 'Relancer le devis',
  canal: 'email',
  type: 'email',
  fait: false,
  echeance: '2026-01-01T08:00:00Z',
  contact: { id: 'c1', nom: 'Dana Imaginaire', email: 'dana@exemple.test' },
  entreprise: { id: 'e1', nom: 'Retard Fictif' },
  opportunite: { id: 'o99', titre: 'Devis', clos: null },
};

describe('AideRelance', () => {
  beforeEach(() => {
    localStorage.clear();
    api.fetchPipeline.mockResolvedValue({
      etapes: [
        { id: 'detection', label: 'Détection' },
        { id: 'prospection', label: 'Prospection' },
        { id: 'proposition', label: 'Proposition' },
      ],
      inactiviteJours: 14,
      opportunites: Array.from({ length: 12 }, (_, i) => opp(i + 1)),
    });
    api.fetchTaches.mockResolvedValue({ enRetard: [tacheRetard] });
    api.updateTache.mockResolvedValue({});
    api.createTache.mockResolvedValue({});
  });
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it("montre autant d'actions que choisi, retient le choix et signale le reste en attente", async () => {
    render(<AideRelance slug="simatis" />);
    expect(await screen.findByText('Retard Fictif')).toBeTruthy();
    // 13 actions possibles, 10 affichées par défaut.
    expect(screen.getAllByRole('button', { name: /Ouvrir/ })).toHaveLength(10);
    expect(screen.getByText(/\+ 3 autre\(s\) en attente/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '5' }));
    expect(screen.getAllByRole('button', { name: /Ouvrir/ })).toHaveLength(5);
    expect(localStorage.getItem('aideRelance:nb')).toBe('5');

    cleanup();
    render(<AideRelance slug="simatis" />);
    await screen.findByText('Retard Fictif');
    expect(screen.getAllByRole('button', { name: /Ouvrir/ })).toHaveLength(5);

    fireEvent.click(screen.getByRole('button', { name: 'Tout' }));
    expect(screen.getAllByRole('button', { name: /Ouvrir/ })).toHaveLength(13);
  });

  it('filtre par source', async () => {
    render(<AideRelance slug="simatis" />);
    await screen.findByText('Retard Fictif');
    fireEvent.click(screen.getByRole('button', { name: /^En retard \(1\)/ }));
    expect(screen.getAllByRole('button', { name: /Ouvrir/ })).toHaveLength(1);
  });

  it('ouvre le mail préparé au prénom seul, puis crée la suite et clôt la tâche', async () => {
    render(<AideRelance slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Retard Fictif/ }));
    const corps = await screen.findByLabelText<HTMLTextAreaElement>(/Mail préparé/);
    expect(corps.value.startsWith('Bonjour Dana,')).toBe(true);
    expect(screen.getByRole('link', { name: /Ouvrir dans ma messagerie/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Mail envoyé' }));
    fireEvent.click(
      await screen.findByRole('radio', { name: /Relancer par téléphone dans 5 jours/ }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Valider et continuer' }));

    await waitFor(() =>
      expect(api.updateTache).toHaveBeenCalledWith('simatis', 't1', { fait: true }),
    );
    expect(api.createTache).toHaveBeenCalledWith(
      'simatis',
      expect.objectContaining({
        type: 'appel',
        entrepriseId: 'e1',
        contactId: 'c1',
        opportuniteId: 'o99',
        hubspot: false,
      }),
    );
    await waitFor(() => expect(screen.queryByRole('button', { name: /Retard Fictif/ })).toBeNull());
    expect(screen.getByText("1 faite(s) aujourd'hui")).toBeTruthy();
  });

  it('écarte une action pour de bon et retient les actions écartées', async () => {
    render(<AideRelance slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Retard Fictif/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Pas pertinent' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Retard Fictif/ })).toBeNull());
    expect(api.updateTache).not.toHaveBeenCalled();

    cleanup();
    render(<AideRelance slug="simatis" />);
    await screen.findByText(/Société fictive 12/);
    expect(screen.queryByText('Retard Fictif')).toBeNull();
  });

  it("n'envoie ni ne crée rien tant que Marc n'a pas validé", async () => {
    render(<AideRelance slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Retard Fictif/ }));
    await screen.findByLabelText(/Mail préparé/);
    expect(api.updateTache).not.toHaveBeenCalled();
    expect(api.createTache).not.toHaveBeenCalled();
  });

  it("affiche la fiche d'appel pour une tâche d'appel", async () => {
    api.fetchTaches.mockResolvedValue({
      enRetard: [{ ...tacheRetard, id: 't2', canal: 'appel', type: 'appel' }],
    });
    render(<AideRelance slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Retard Fictif/ }));
    const volet = await screen.findByRole('dialog');
    expect(within(volet).getByText("Objectif de l'appel")).toBeTruthy();
    expect(within(volet).getByText(/Marc de SIMATIS/)).toBeTruthy();
  });

  it('indique une erreur de chargement sans planter', async () => {
    api.fetchPipeline.mockRejectedValue(new Error('hors ligne'));
    render(<AideRelance slug="simatis" />);
    expect(await screen.findByText(/Impossible de charger/)).toBeTruthy();
  });
});
