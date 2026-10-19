// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjetDiag } from '../api.js';
import { Diagnostic, entreesRevue, modifierRevue } from './Diagnostic.js';

const api = vi.hoisted(() => ({
  fetchProjetsDiag: vi.fn(),
  creerProjetDiag: vi.fn(),
  majProjetDiag: vi.fn(),
  envoyerMessageDiag: vi.fn(),
}));
vi.mock('../api.js', () => api);

const projet = (extra: Partial<ProjetDiag> = {}): ProjetDiag => ({
  id: 'p1',
  nom: 'Atelier Fictif Nord',
  activite: 'usinage',
  contexte: '',
  etape: 1,
  dims: null,
  statutDiagnostic: null,
  dateDiagnostic: null,
  chats: {},
  profil: null,
  revue: null,
  conversation: [],
  statutChat: 'repos',
  aRapport: false,
  rapportNom: null,
  updatedAt: '2026-10-19T08:00:00.000Z',
  ...extra,
});

beforeEach(() => {
  api.fetchProjetsDiag.mockResolvedValue([projet()]);
  api.majProjetDiag.mockImplementation((_slug: string, _id: string, patch: Partial<ProjetDiag>) =>
    Promise.resolve(projet({ ...patch, id: 'p1' })),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Diagnostic', () => {
  it('liste les projets puis ouvre celui choisi', async () => {
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    expect(await screen.findByRole('heading', { name: 'Atelier Fictif Nord' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Préparer la présentation/ })).toBeTruthy();
  });

  it('crée un projet avec son nom et son activité', async () => {
    api.creerProjetDiag.mockResolvedValue(
      projet({ id: 'p2', nom: 'Bureau Fictif', activite: 'services' }),
    );
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Nouveau projet' }));
    fireEvent.change(screen.getByLabelText('Nom de l’entreprise'), {
      target: { value: 'Bureau Fictif' },
    });
    fireEvent.change(screen.getByLabelText('Activité'), { target: { value: 'services' } });
    fireEvent.click(screen.getByRole('button', { name: 'Créer et préparer' }));
    await waitFor(() =>
      expect(api.creerProjetDiag).toHaveBeenCalledWith('simatis', 'Bureau Fictif', 'services'),
    );
  });

  it('calcule le profil après la saisie du résultat à l étape 2', async () => {
    api.fetchProjetsDiag.mockResolvedValue([projet({ etape: 2 })]);
    api.majProjetDiag.mockResolvedValue(
      projet({
        etape: 2,
        dims: { outils: 2.5, strategie: 5.3, polyvalence: 9.5 },
        profil: 'Joggeur',
      }),
    );
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    fireEvent.change(await screen.findByLabelText('Outils et méthode (sur 10)'), {
      target: { value: '2.5' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le résultat' }));
    await waitFor(() => expect(api.majProjetDiag).toHaveBeenCalled());
    const patch = api.majProjetDiag.mock.calls[0]?.[2] as Partial<ProjetDiag>;
    expect(patch.dims?.outils).toBe(2.5);
    expect(await screen.findByText('Profil : Joggeur')).toBeTruthy();
  });

  it('refuse un lien qui ne pointe pas vers claude.ai et garde le lien valide', async () => {
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    const lien = await screen.findByLabelText(/Lien du chat claude.ai/);
    fireEvent.change(lien, { target: { value: 'https://exemple.com/chat' } });
    fireEvent.blur(lien);
    expect(await screen.findByText('Le lien doit pointer vers claude.ai.')).toBeTruthy();
    expect(api.majProjetDiag).not.toHaveBeenCalled();

    fireEvent.change(lien, { target: { value: 'https://claude.ai/chat/fictif' } });
    fireEvent.blur(lien);
    await waitFor(() => expect(api.majProjetDiag).toHaveBeenCalled());
    const patch = api.majProjetDiag.mock.calls[0]?.[2] as Partial<ProjetDiag>;
    expect(patch.chats?.['1']?.lien).toBe('https://claude.ai/chat/fictif');
  });
});

describe('Formulaire de revue saisi dans l OS', () => {
  const revue = {
    statut: 'brouillon',
    preconisations: {
      r1: { choix: 'garder', detail: 'Commentaire fictif.', texte: 'Proposition fictive.' },
    },
    planAction: {
      court: { libre: '', blocs: { b3: { bloc: '3. Information', choix: 'garder', detail: '' } } },
    },
    libre: 'Remarque fictive.',
  };

  it('liste les entrées avec leur choix et leur commentaire', () => {
    const entrees = entreesRevue(revue);
    expect(entrees[0]).toMatchObject({
      titre: 'Préconisation r1',
      choix: 'garder',
      valeur: 'Commentaire fictif.',
      propose: 'Proposition fictive.',
    });
    expect(entrees.find((e) => e.titre.startsWith('Court terme · 3.'))).toMatchObject({
      choix: 'garder',
    });
  });

  it('modifie un seul champ, sans toucher au reste', () => {
    const suite = modifierRevue(
      revue,
      { chemin: ['preconisations', 'r1'], champ: 'detail' },
      'Nouveau fictif.',
    );
    expect(suite.preconisations).toEqual({
      r1: { choix: 'garder', detail: 'Nouveau fictif.', texte: 'Proposition fictive.' },
    });
    expect(revue.preconisations.r1.detail).toBe('Commentaire fictif.');
  });
});

describe('Assistant de l étape', () => {
  it('envoie un message et montre que Claude prépare sa réponse', async () => {
    api.fetchProjetsDiag.mockResolvedValue([projet({ etape: 3 })]);
    api.envoyerMessageDiag.mockResolvedValue(
      projet({
        etape: 3,
        statutChat: 'attente_claude',
        conversation: [
          { etape: 3, de: 'pilote', texte: 'Question fictive', at: '2026-10-19T08:00:00.000Z' },
        ],
      }),
    );
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    fireEvent.change(await screen.findByPlaceholderText('Votre message'), {
      target: { value: 'Question fictive' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer' }));
    await waitFor(() =>
      expect(api.envoyerMessageDiag).toHaveBeenCalledWith('simatis', 'p1', 'Question fictive'),
    );
    expect(await screen.findByText('Question fictive')).toBeTruthy();
    expect(screen.getByText(/Claude prépare sa réponse/)).toBeTruthy();
  });
});
