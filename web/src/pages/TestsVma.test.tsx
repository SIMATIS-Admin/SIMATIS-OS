// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TestVma } from '../api.js';
import { fmtEur, libelleStatut, TestsVma } from './TestsVma.js';

const api = vi.hoisted(() => ({
  fetchTestsVma: vi.fn(),
  creerTestVma: vi.fn(),
  revoquerTestVma: vi.fn(),
}));
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
});
