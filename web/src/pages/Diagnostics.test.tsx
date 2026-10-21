// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entreprise, ProjetDiag, TestVma } from '../api.js';
import { Diagnostics } from './Diagnostics.js';

const api = vi.hoisted(() => ({
  fetchEntreprises: vi.fn(),
  fetchProjetsDiag: vi.fn(),
  fetchTestsVma: vi.fn(),
  revoquerTestVma: vi.fn(),
}));
vi.mock('../api.js', () => api);

const entreprise = (n: number, extra: Partial<Entreprise> = {}): Entreprise =>
  ({
    id: `e${n}`,
    nom: `Entreprise Fictive ${String.fromCharCode(64 + n)}`,
    secteur: 'Conseil',
    ville: null,
    taille: null,
    domaine: null,
    nbContacts: 0,
    oppsOuvertes: 0,
    ...extra,
  }) as Entreprise;

const test = (extra: Partial<TestVma>): TestVma =>
  ({
    id: 't',
    entrepriseId: null,
    entrepriseNom: 'Entreprise Fictive',
    type: 'premier',
    statut: 'utilisee',
    lien: 'https://exemple.invalid/vma/t',
    expireLe: '2030-01-01T00:00:00Z',
    creeLe: '2026-04-01T09:00:00Z',
    recueLe: null,
    resultat: null,
    ...extra,
  }) as TestVma;

const resultat = (vma: number) => ({ vma, mesurable: true }) as TestVma['resultat'];

const charger = (entreprises: Entreprise[], projets: ProjetDiag[] = [], tests: TestVma[] = []) => {
  api.fetchEntreprises.mockResolvedValue(entreprises);
  api.fetchProjetsDiag.mockResolvedValue(projets);
  api.fetchTestsVma.mockResolvedValue(tests);
};

// Une entreprise n'apparaît dans la liste que si elle est suivie : on lui donne un diagnostic.
const diagPour = (n: number): ProjetDiag =>
  ({
    id: `p${n}`,
    nom: `Projet ${n}`,
    activite: 'services',
    contexte: '',
    etape: 1,
    etapeMax: 1,
    entrepriseId: `e${n}`,
    statutDiagnostic: null,
  }) as ProjetDiag;

const lignes = () => Array.from(document.querySelectorAll('.dg-ligne'));

describe('Diagnostics : écran fusionné', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => cleanup());

  it('affiche au plus 5 entreprises et la pagination', async () => {
    charger(
      Array.from({ length: 6 }, (_, i) => entreprise(i + 1)),
      Array.from({ length: 6 }, (_, i) => diagPour(i + 1)),
    );
    render(<Diagnostics slug="demo" />);
    await screen.findByText('Entreprise Fictive A');
    expect(lignes()).toHaveLength(5);
    expect(screen.getByText(/Entreprises 1 à 5 sur 6/)).toBeTruthy();
  });

  it('ouvre une ligne au clic sur « Détail » et la referme sur « Réduire »', async () => {
    charger([entreprise(1)], [diagPour(1)]);
    render(<Diagnostics slug="demo" />);
    const bouton = await screen.findByRole('button', { name: /Détail/ });
    expect(bouton.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(bouton);
    expect(screen.getByRole('button', { name: /Réduire/ }).getAttribute('aria-expanded')).toBe(
      'true',
    );
  });

  it('« Résultat complet » ouvre l’écran du dirigeant, avec « par où commencer », et revient', async () => {
    const complet = {
      entreprise: 'Entreprise Fictive',
      vma: 3400,
      mesurable: true,
      statut: 'prouvée',
      tenue: 'tenue',
      allureVisee: 8000,
      echeance: 2,
      niveau: { cle: 'amb', label: 'Ambitieux', phrase: 'Phrase du niveau fictive.' },
      ecart: 4600,
      ecartPct: 1.35,
      freins: [
        {
          n: 1,
          titre: 'Frein fictif',
          phrase: 'Phrase du frein.',
          enjeu: 1200,
          debut: ['Première action fictive'],
        },
      ],
      textes: { libelleDebut: 'Par où commencer', noteEnjeu: 'Estimation moyenne fictive.' },
    } as TestVma['resultat'];
    charger(
      [entreprise(1)],
      [],
      [test({ id: 'a', entrepriseId: 'e1', recueLe: '2026-04-14T10:00:00Z', resultat: complet })],
    );
    render(<Diagnostics slug="demo" />);
    fireEvent.click(await screen.findByRole('button', { name: /Détail/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Résultat complet' }));
    expect(screen.getByText('Votre VMA commerciale')).toBeTruthy();
    expect(screen.getByText('Frein fictif')).toBeTruthy();
    expect(screen.getByText('Première action fictive')).toBeTruthy();
    expect(screen.getByText(/Estimation moyenne fictive/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Retour/ }));
    expect(await screen.findByRole('button', { name: /Réduire/ })).toBeTruthy();
  });

  it('la recherche revient à la page 1 et trouve une entreprise sur toutes les pages', async () => {
    charger(
      Array.from({ length: 6 }, (_, i) => entreprise(i + 1)),
      Array.from({ length: 6 }, (_, i) => diagPour(i + 1)),
    );
    render(<Diagnostics slug="demo" />);
    await screen.findByText('Entreprise Fictive A');
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    expect(screen.getByText('Entreprise Fictive F')).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'fictive b' } });
    await waitFor(() => expect(lignes()).toHaveLength(1));
    expect(screen.getByText('Entreprise Fictive B')).toBeTruthy();
  });

  it("n'affiche pas un essai dans le graphique d'évolution", async () => {
    charger(
      [entreprise(1)],
      [],
      [
        test({
          id: 'a',
          entrepriseId: 'e1',
          type: 'premier',
          recueLe: '2026-04-14T10:00:00Z',
          resultat: resultat(3400),
        }),
        test({
          id: 'b',
          entrepriseId: 'e1',
          type: 'premier',
          recueLe: '2026-10-02T10:00:00Z',
          resultat: resultat(4150),
        }),
        test({
          id: 'c',
          entrepriseId: 'e1',
          type: 'essai',
          recueLe: '2026-10-15T10:00:00Z',
          resultat: resultat(2100),
        }),
      ],
    );
    render(<Diagnostics slug="demo" />);
    fireEvent.click(await screen.findByRole('button', { name: /Détail/ }));
    const evolution = document.querySelector('.dg-evolution') as HTMLElement;
    expect(evolution.querySelectorAll('.dg-barre')).toHaveLength(2);
    const dernier = document.querySelector('.dg-resultat') as HTMLElement;
    expect(within(dernier).getByText(/Essai \(non compté dans l’historique\)/)).toBeTruthy();
  });
});
