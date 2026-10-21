// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TestVma } from '../api.js';
import { fmtEur, libelleStatut, TestsVma } from './TestsVma.js';

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
    fetchTestsVma: vi.fn(),
    creerTestVma: vi.fn(),
    revoquerTestVma: vi.fn(),
  };
});
vi.mock('../api.js', () => api);

const test = (extra: Partial<TestVma> = {}): TestVma => ({
  id: 't1',
  entrepriseId: null,
  entrepriseNom: 'Atelier Fictif',
  contactNom: null,
  contactEmail: null,
  type: 'premier',
  statut: 'envoyee',
  lien: 'https://www.simatis.fr/test-vma?i=abc',
  expireLe: '2099-01-01T00:00:00.000Z',
  creeLe: '2026-10-20T08:00:00.000Z',
  recueLe: null,
  version: null,
  resultat: null,
  calcul: null,
  ...extra,
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Tests VMA : libellés et formats', () => {
  it("nomme le statut d'une invitation selon son état et sa date", () => {
    expect(libelleStatut(test())).toBe('Envoyée');
    expect(libelleStatut(test({ expireLe: '2000-01-01T00:00:00.000Z' }))).toBe('Expirée');
    expect(libelleStatut(test({ statut: 'utilisee' }))).toBe('Utilisée');
    expect(libelleStatut(test({ statut: 'revoquee' }))).toBe('Révoquée');
  });

  it('formate les euros comme le reste de l’OS', () => {
    expect(fmtEur(15000)).toBe('15\u00a0k€');
    expect(fmtEur(850)).toBe('850\u00a0€');
    expect(fmtEur(null)).toBe('—');
  });
});

describe('Tests VMA : écran', () => {
  it('affiche la liste, et la fiche avec le détail réservé à Marc', async () => {
    api.fetchTestsVma.mockResolvedValue([
      test({
        statut: 'utilisee',
        recueLe: '2026-10-20T09:00:00.000Z',
        resultat: {
          entreprise: 'Atelier Fictif',
          vma: 15000,
          mesurable: true,
          statut: 'prouvée',
          tenue: 'tenue',
          allureVisee: 20000,
          echeance: 2,
          niveau: { cle: 'real', label: 'Réaliste', phrase: 'Phrase fictive.' },
          ecart: 5000,
          freins: [{ n: 1, titre: 'Le temps de vente', phrase: 'Phrase fictive.' }],
        },
        calcul: {
          potentiel: 11718.75,
          niveau: { cle: 'real', part: 0.427 },
          freins: [
            {
              n: 1,
              label: 'Temps commercial',
              note: 2,
              gainMax: 0.5,
              gainRestant: 0.25,
              bloc: '6. Plan de canaux',
            },
          ],
        },
      }),
    ]);
    render(<TestsVma slug="mandat-fictif" />);

    await waitFor(() => expect(screen.getByText('Atelier Fictif')).toBeTruthy());
    expect(screen.getByText(/Utilisée/)).toBeTruthy();
    screen.getByRole('button', { name: 'Voir le résultat' }).click();
    await waitFor(() => expect(screen.getByText('Pour Marc uniquement')).toBeTruthy());
    expect(screen.getByText('6. Plan de canaux')).toBeTruthy();
    expect(screen.getByText(/Potentiel brut/)).toBeTruthy();
  });

  it('v2.0 : montre la trajectoire, le portefeuille et le poids de chaque frein', async () => {
    api.fetchTestsVma.mockResolvedValue([
      test({
        statut: 'utilisee',
        recueLe: '2026-10-21T09:00:00.000Z',
        resultat: {
          entreprise: 'Atelier Fictif',
          vma: 15000,
          mesurable: true,
          statut: 'prouvée',
          tenue: 'tenue',
          recurrent: 8000,
          allureActuelle: 23000,
          trajectoire: 19826.68,
          socleEcheance: 4826.68,
          allureVisee: 20000,
          echeance: 2,
          niveau: { cle: 'real', label: 'Réaliste', phrase: 'Phrase fictive.' },
          ecart: 173.32,
          freins: [{ n: 1, titre: 'Le temps de vente', phrase: 'Phrase fictive.' }],
        },
        calcul: {
          recurrent: 8000,
          potentiel: 11718.75,
          potentielVma: 11718.75,
          partRec: 0,
          attrition: 0.25,
          developpement: 0,
          niveau: { cle: 'real', part: 0.015 },
          freins: [
            {
              n: 8,
              label: 'Frein fictif',
              note: 1,
              gainMax: 0.5,
              gainRestant: 0.375,
              bloc: 'Bloc fictif',
              moteur: 'portefeuille',
              effet: 'attrition',
              impact: 1200,
            },
          ],
        },
      }),
    ]);
    render(<TestsVma slug="mandat-fictif" />);

    await waitFor(() => expect(screen.getByText('Atelier Fictif')).toBeTruthy());
    screen.getByRole('button', { name: 'Voir le résultat' }).click();
    await waitFor(() => expect(screen.getByText(/Sur sa lancée dans 2 an/)).toBeTruthy());
    expect(screen.getByText(/attrition 25/)).toBeTruthy();
    expect(screen.getByText('Frein fictif (portefeuille)')).toBeTruthy();
    expect(screen.getByText(/\+1,2.k€ \/ mois/)).toBeTruthy();
  });

  it("demande confirmation à l'alerte du semestre, puis crée si Marc confirme", async () => {
    api.fetchTestsVma.mockResolvedValue([]);
    api.creerTestVma
      .mockRejectedValueOnce(
        new api.ApiError('Atelier Fictif a déjà passé un test.', 409, { code: 'semestre' }),
      )
      .mockResolvedValueOnce(test({ lien: 'https://www.simatis.fr/test-vma?i=ok' }));
    const confirme = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<TestsVma slug="mandat-fictif" />);

    await waitFor(() => expect(screen.getByText('Aucune invitation pour l’instant.')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Entreprise'), { target: { value: 'Atelier Fictif' } });
    fireEvent.click(screen.getByRole('button', { name: 'Créer l’invitation' }));

    await waitFor(() => expect(api.creerTestVma).toHaveBeenCalledTimes(2));
    expect(confirme).toHaveBeenCalled();
    expect(api.creerTestVma.mock.calls[1]?.[1]).toMatchObject({ confirmerSemestre: true });
    confirme.mockRestore();
  });
});
