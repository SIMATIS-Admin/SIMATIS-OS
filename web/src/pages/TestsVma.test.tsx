// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TestVma } from '../api.js';
import {
  etapesFrise,
  fmtEur,
  libelleStatut,
  peutRelancer,
  sansReponse,
  TestsVma,
} from './TestsVma.js';

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
    relancerTestVma: vi.fn(),
  };
});
vi.mock('../api.js', () => api);

const test = (extra: Partial<TestVma> = {}): TestVma => ({
  id: 't1',
  entrepriseId: null,
  entrepriseNom: 'Atelier Fictif',
  contactNom: null,
  contactEmail: null,
  tutoiement: false,
  envoyeeLe: null,
  relances: [],
  echecEnvoi: null,
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

  it('v2.2 : montre comme le mail les deux listes de freins du mode portefeuille, avec leur détail', async () => {
    const frein = (n: number, titre: string, extra = {}) => ({
      n,
      titre,
      phrase: `Phrase ${titre}.`,
      enjeu: 5000,
      reponse: `Réponse ${titre}`,
      cible: `Cible ${titre}`,
      debut: [`Action ${titre}`],
      signe: `Signe ${titre}`,
      ...extra,
    });
    api.fetchTestsVma.mockResolvedValue([
      test({
        statut: 'utilisee',
        recueLe: '2026-10-22T09:00:00.000Z',
        resultat: {
          entreprise: 'Atelier Fictif',
          vma: 14000,
          mesurable: true,
          statut: 'prouvée',
          tenue: 'en dents de scie',
          recurrent: 80000,
          allureActuelle: 94000,
          trajectoire: 107000,
          socleEcheance: 107000,
          allureVisee: 125000,
          echeance: 2,
          niveau: { cle: 'real', label: 'Réaliste', phrase: 'Phrase fictive.' },
          ecart: 18000,
          modePortefeuille: true,
          spotCible: 18600,
          spotEcheance: 0,
          ecartSpot: 18600,
          recurrentCible: 106400,
          ecartRecurrent: -600,
          freins: [frein(1, 'Frein A'), frein(9, 'Frein B')],
          freinsConquete: [frein(1, 'Frein A')],
          freinsPortefeuille: [frein(9, 'Frein B')],
          textes: {
            titreConquete: 'Conquête fictive',
            titrePortefeuille: 'Portefeuille fictif',
            noteEnjeu: 'Estimation moyenne fictive.',
          },
        },
      }),
    ]);
    render(<TestsVma slug="mandat-fictif" />);

    await waitFor(() => expect(screen.getByText('Atelier Fictif')).toBeTruthy());
    screen.getByRole('button', { name: 'Voir le résultat' }).click();
    await waitFor(() => expect(screen.getByText('Conquête fictive')).toBeTruthy());
    expect(screen.getByText('Portefeuille fictif')).toBeTruthy();
    expect(screen.getByText(/Nouvelles affaires : votre cible est de 18,6.k€/)).toBeTruthy();
    expect(screen.getByText(/Action Frein B/)).toBeTruthy();
    expect(screen.getByText(/Signe Frein A/)).toBeTruthy();
    expect(screen.getAllByText(/environ \+5.k€ par mois\*/)).toHaveLength(2);
    expect(screen.getByText(/\* Estimation moyenne fictive\./)).toBeTruthy();
    // Chaque frein n'apparaît qu'une fois : la liste à plat n'est plus montrée en plus des deux sections.
    expect(screen.getAllByText('Frein A')).toHaveLength(1);
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

  it('la case « Tutoyer » du formulaire part avec l’invitation, décochée par défaut', async () => {
    api.fetchTestsVma.mockResolvedValue([]);
    api.creerTestVma.mockResolvedValue({ ...test(), envoi: null });
    render(<TestsVma slug="mandat-fictif" />);
    await waitFor(() => expect(screen.getByText('Aucune invitation pour l’instant.')).toBeTruthy());
    const case_ = screen.getByLabelText<HTMLInputElement>('Tutoyer le dirigeant');
    expect(case_.checked).toBe(false);
    fireEvent.change(screen.getByLabelText('Entreprise'), { target: { value: 'Atelier Fictif' } });
    fireEvent.click(case_);
    fireEvent.click(screen.getByRole('button', { name: 'Créer l’invitation' }));
    await waitFor(() => expect(api.creerTestVma).toHaveBeenCalled());
    expect(api.creerTestVma.mock.calls[0]?.[1]).toMatchObject({ tutoiement: true });
  });
});

const enCours = (extra: Partial<TestVma> = {}) =>
  test({
    contactEmail: 'jeanne@exemple.test',
    envoyeeLe: '2026-10-12T08:00:00.000Z',
    ...extra,
  });

describe('Tests VMA : suivi des envois', () => {
  it('la frise montre l’envoi, les relances et le résultat, le reste grisé', () => {
    const t = enCours({
      relances: [{ le: '2026-10-19T08:00:00.000Z', origine: 'auto' }],
    });
    expect(etapesFrise(t)).toEqual([
      { libelle: 'Envoyé 12/10', fait: true },
      { libelle: 'Relancé 19/10 (auto)', fait: true },
      { libelle: 'Test passé', fait: false },
    ]);
    expect(etapesFrise({ ...t, statut: 'utilisee' }).at(-1)).toEqual({
      libelle: 'Test passé',
      fait: true,
    });
    expect(etapesFrise(test())[0]).toEqual({ libelle: 'Envoyé', fait: false });
  });

  it('le bouton Relancer est réservé aux invitations ouvertes avec une adresse', () => {
    const maintenant = Date.parse('2026-11-02T08:00:00.000Z');
    expect(peutRelancer(enCours(), maintenant)).toBe(true);
    expect(peutRelancer(enCours({ statut: 'utilisee' }), maintenant)).toBe(false);
    expect(peutRelancer(enCours({ statut: 'revoquee' }), maintenant)).toBe(false);
    expect(peutRelancer(enCours({ expireLe: '2026-10-30T00:00:00.000Z' }), maintenant)).toBe(false);
    expect(peutRelancer(test(), maintenant)).toBe(false);
  });

  it('le filtre garde les invitations ouvertes envoyées il y a plus de 7 jours', () => {
    const maintenant = Date.parse('2026-11-02T08:00:00.000Z');
    expect(sansReponse(enCours(), maintenant)).toBe(true);
    expect(sansReponse(enCours({ envoyeeLe: '2026-10-30T08:00:00.000Z' }), maintenant)).toBe(false);
    expect(sansReponse(enCours({ statut: 'utilisee' }), maintenant)).toBe(false);
    expect(sansReponse(test(), maintenant)).toBe(false);
  });

  it('relancer demande le registre, préremplit « Tutoyer » et envoie le choix', async () => {
    api.fetchTestsVma.mockResolvedValue([enCours({ tutoiement: true })]);
    api.relancerTestVma.mockResolvedValue({ ...enCours(), envoi: { statut: 'envoye' } });
    render(<TestsVma slug="mandat-fictif" />);
    await waitFor(() => expect(screen.getByText('Atelier Fictif')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Relancer' }));
    const tu = screen.getByLabelText<HTMLInputElement>('Tutoyer pour cette relance');
    expect(tu.checked).toBe(true);
    fireEvent.click(tu);
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer la relance' }));
    await waitFor(() =>
      expect(api.relancerTestVma).toHaveBeenCalledWith('mandat-fictif', 't1', false),
    );
    await waitFor(() => expect(screen.getByText(/Relance envoyée/)).toBeTruthy());
  });

  it('le filtre « Sans réponse » masque les invitations récentes ou terminées', async () => {
    api.fetchTestsVma.mockResolvedValue([
      enCours({ id: 'ancienne', entrepriseNom: 'Atelier Ancien' }),
      enCours({
        id: 'recente',
        entrepriseNom: 'Atelier Récent',
        envoyeeLe: new Date().toISOString(),
      }),
    ]);
    render(<TestsVma slug="mandat-fictif" />);
    await waitFor(() => expect(screen.getByText('Atelier Récent')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Sans réponse depuis plus de 7 jours'));
    expect(screen.queryByText('Atelier Récent')).toBeNull();
    expect(screen.getByText('Atelier Ancien')).toBeTruthy();
  });
});
