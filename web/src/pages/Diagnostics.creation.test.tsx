// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entreprise, ProjetDiag, TestVma } from '../api.js';
import { Diagnostics } from './Diagnostics.js';

const api = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly corps: Record<string, unknown>,
    ) {
      super(message);
    }
  }
  return {
    ApiError,
    fetchEntreprises: vi.fn(),
    fetchProjetsDiag: vi.fn(),
    fetchTestsVma: vi.fn(),
    revoquerTestVma: vi.fn(),
    creerProjetDiag: vi.fn(),
    creerTestVma: vi.fn(),
    createEntreprise: vi.fn(),
  };
});
vi.mock('../api.js', () => api);

const entreprise = (id: string, nom: string): Entreprise =>
  ({
    id,
    nom,
    secteur: 'Conseil',
    ville: null,
    taille: null,
    domaine: null,
    nbContacts: 0,
    oppsOuvertes: 0,
  }) as Entreprise;

const projet = (extra: Partial<ProjetDiag>): ProjetDiag =>
  ({
    id: 'p',
    nom: 'Projet',
    activite: 'services',
    etape: 1,
    etapeMax: 1,
    entrepriseId: null,
    statutDiagnostic: null,
    ...extra,
  }) as ProjetDiag;

const test = (extra: Partial<TestVma>): TestVma =>
  ({
    id: 't',
    entrepriseId: null,
    entrepriseNom: 'X',
    type: 'premier',
    statut: 'envoyee',
    lien: 'https://exemple.invalid/vma/t',
    expireLe: '2030-01-01T00:00:00Z',
    creeLe: '2026-04-01T09:00:00Z',
    recueLe: null,
    resultat: null,
    ...extra,
  }) as TestVma;

const charger = (entreprises: Entreprise[], projets: ProjetDiag[] = [], tests: TestVma[] = []) => {
  api.fetchEntreprises.mockResolvedValue(entreprises);
  api.fetchProjetsDiag.mockResolvedValue(projets);
  api.fetchTestsVma.mockResolvedValue(tests);
};

describe('Diagnostics : création', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => cleanup());

  it('« Lancer le diagnostic » crée un diagnostic rattaché à l’entreprise', async () => {
    charger([entreprise('e1', 'Entreprise Fictive A')]);
    api.creerProjetDiag.mockResolvedValue(projet({ id: 'nouveau', entrepriseId: 'e1' }));
    render(<Diagnostics slug="demo" />);
    fireEvent.click(await screen.findByRole('button', { name: /Détail/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Lancer le diagnostic' }));
    fireEvent.click(screen.getByRole('button', { name: 'Créer le diagnostic' }));
    await waitFor(() =>
      expect(api.creerProjetDiag).toHaveBeenCalledWith(
        'demo',
        'Entreprise Fictive A',
        expect.any(String),
        'e1',
      ),
    );
  });

  it('« Nouveau diagnostic » sur une entreprise déjà suivie propose une nouvelle année', async () => {
    charger(
      [entreprise('e1', 'Entreprise Fictive A')],
      [projet({ id: 'ancien', entrepriseId: 'e1', statutDiagnostic: null })],
    );
    api.creerProjetDiag.mockResolvedValue(projet({ id: 'nouveau', entrepriseId: 'e1' }));
    render(<Diagnostics slug="demo" />);
    await screen.findByRole('button', { name: /Détail/ });
    fireEvent.click(screen.getByRole('button', { name: '+ Nouveau' }));
    fireEvent.click(screen.getByRole('button', { name: /Nouveau diagnostic/ }));
    fireEvent.change(screen.getByLabelText('Entreprise'), { target: { value: 'e1' } });
    expect(screen.getByText(/nouvelle année/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Créer le diagnostic' }));
    await waitFor(() => expect(api.creerProjetDiag).toHaveBeenCalledTimes(1));
  });

  it('un test VMA avec un nom inconnu crée d’abord l’entreprise', async () => {
    charger([]);
    api.createEntreprise.mockResolvedValue({ id: 'e9' });
    api.creerTestVma.mockResolvedValue(test({ id: 'v1', entrepriseId: 'e9' }));
    render(<Diagnostics slug="demo" />);
    await screen.findByText('Aucune entreprise.');
    fireEvent.click(screen.getByRole('button', { name: '+ Nouveau' }));
    fireEvent.click(screen.getByRole('button', { name: /Nouveau test VMA/ }));
    fireEvent.change(screen.getByLabelText('Nom de l’entreprise (nouvelle)'), {
      target: { value: 'Entreprise Fictive N' },
    });
    fireEvent.change(screen.getByLabelText('Dirigeant qui passe le test'), {
      target: { value: 'Dirigeant Fictif' },
    });
    fireEvent.change(screen.getByLabelText('E-mail du dirigeant'), {
      target: { value: 'd@exemple.invalid' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Créer l’invitation' }));
    await waitFor(() => expect(api.creerTestVma).toHaveBeenCalledTimes(1));
    expect(api.createEntreprise).toHaveBeenCalledWith('demo', { nom: 'Entreprise Fictive N' });
    expect(api.creerTestVma).toHaveBeenCalledWith(
      'demo',
      expect.objectContaining({
        entrepriseId: 'e9',
        entrepriseNom: 'Entreprise Fictive N',
        type: 'premier',
      }),
    );
  });

  it('la règle du semestre demande une confirmation avant de créer', async () => {
    charger([entreprise('e1', 'Entreprise Fictive A')]);
    api.creerTestVma
      .mockRejectedValueOnce(
        new api.ApiError('Atelier Fictif a déjà passé un test.', 409, { code: 'semestre' }),
      )
      .mockResolvedValueOnce(test({ id: 'v2', entrepriseId: 'e1' }));
    render(<Diagnostics slug="demo" />);
    fireEvent.click(await screen.findByRole('button', { name: /Détail/ }));
    fireEvent.click(screen.getByRole('button', { name: '+ Nouveau test VMA' }));
    fireEvent.change(screen.getByLabelText('Dirigeant qui passe le test'), {
      target: { value: 'Dirigeant Fictif' },
    });
    fireEvent.change(screen.getByLabelText('E-mail du dirigeant'), {
      target: { value: 'd@exemple.invalid' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Créer l’invitation' }));
    expect(await screen.findByText(/déjà passé un test/)).toBeTruthy();
    expect(api.creerTestVma).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Créer quand même' }));
    await waitFor(() => expect(api.creerTestVma).toHaveBeenCalledTimes(2));
    expect(api.creerTestVma).toHaveBeenLastCalledWith(
      'demo',
      expect.objectContaining({ confirmerSemestre: true }),
    );
  });
});
