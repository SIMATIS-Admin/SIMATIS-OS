// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AtelierListe, Entreprise, ProjetDiag, TestVma } from '../api.js';
import { Atelier } from './Atelier.js';

const api = vi.hoisted(() => ({
  fetchEntreprises: vi.fn(),
  fetchProjetsDiag: vi.fn(),
  fetchTestsVma: vi.fn(),
  fetchAteliers: vi.fn(),
  fetchAtelier: vi.fn(),
  creerAtelier: vi.fn(),
  importerAtelier: vi.fn(),
  supprimerAtelier: vi.fn(),
}));
vi.mock('../api.js', () => api);
// L'atelier ouvert a ses propres tests : ici seuls comptent ce que l'accueil lui passe et le retour.
vi.mock('./atelier/AtelierVue.js', () => ({
  AtelierVue: ({
    atelier,
    essai,
    onRetour,
  }: {
    atelier: { id: string } | null;
    essai: boolean;
    onRetour: () => void;
  }) => (
    <div>
      <span>{essai ? 'Vue essai' : `Vue atelier ${atelier?.id}`}</span>
      <button onClick={onRetour}>← Ateliers</button>
    </div>
  ),
}));

const entreprise = (n: number): Entreprise =>
  ({
    id: `e${n}`,
    nom: `Entreprise Fictive ${String.fromCharCode(64 + n)}`,
    secteur: null,
  }) as Entreprise;
const atelier = (n: number, extra: Partial<AtelierListe> = {}): AtelierListe => ({
  id: `a${n}`,
  entrepriseId: `e${n}`,
  titre: `Atelier fictif ${n}`,
  etape: 2,
  etapeMax: 4,
  nbActions: 14,
  updatedAt: '2026-10-27T10:00:00Z',
  createdAt: '2026-10-20T10:00:00Z',
  ...extra,
});
const diag = (n: number): ProjetDiag =>
  ({
    id: `p${n}`,
    nom: 'P',
    entrepriseId: `e${n}`,
    etape: 3,
    etapeMax: 3,
    statutDiagnostic: null,
    updatedAt: '2026-10-01T00:00:00Z',
  }) as ProjetDiag;
const vma = (n: number): TestVma =>
  ({
    id: `t${n}`,
    entrepriseId: `e${n}`,
    creeLe: '2026-10-02T00:00:00Z',
    recueLe: '2026-10-12T00:00:00Z',
    type: 'premier',
    statut: 'utilisee',
  }) as TestVma;

const charger = (
  opts: { e?: Entreprise[]; a?: AtelierListe[]; p?: ProjetDiag[]; t?: TestVma[] } = {},
) => {
  api.fetchEntreprises.mockResolvedValue(opts.e ?? [entreprise(1)]);
  api.fetchAteliers.mockResolvedValue(opts.a ?? [atelier(1)]);
  api.fetchProjetsDiag.mockResolvedValue(opts.p ?? [diag(1)]);
  api.fetchTestsVma.mockResolvedValue(opts.t ?? [vma(1)]);
};

describe('Atelier : accueil de la section', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('affiche la pastille Bêta et liste les entreprises suivies', async () => {
    charger({ e: [entreprise(1), entreprise(2)] });
    render(<Atelier slug="demo" />);
    await screen.findByText('Entreprise Fictive A');
    expect(screen.getAllByText('Bêta').length).toBeGreaterThan(0);
    // l'entreprise B n'a ni diagnostic, ni test, ni atelier : elle n'apparaît pas
    expect(screen.queryByText('Entreprise Fictive B')).toBeNull();
  });

  it('résume le diagnostic, les tests VMA et les ateliers de la ligne', async () => {
    charger();
    render(<Atelier slug="demo" />);
    const ligne = (await screen.findByText('Entreprise Fictive A')).closest(
      '.dg-ligne',
    ) as HTMLElement;
    expect(within(ligne).getByText('Étape 3 sur 5')).toBeTruthy();
    expect(within(ligne).getByText(/1 test · 1 reçu/)).toBeTruthy();
    expect(within(ligne).getByText(/1 · étape 4 sur 6/)).toBeTruthy();
  });

  it('le détail renvoie vers Outils et diagnostics et liste les ateliers', async () => {
    charger();
    render(<Atelier slug="demo" />);
    fireEvent.click(await screen.findByRole('button', { name: /Détail/ }));
    const liens = screen.getAllByRole('link', { name: /Outils et diagnostics/ });
    expect(liens[0]!.getAttribute('href')).toBe('#/demo/diagnostics');
    expect(screen.getByText('Atelier fictif 1')).toBeTruthy();
    expect(screen.getByText(/14 actions/)).toBeTruthy();
  });

  it('+ Nouveau propose un nouvel atelier et l’import', async () => {
    charger();
    render(<Atelier slug="demo" />);
    fireEvent.click(await screen.findByRole('button', { name: '+ Nouveau' }));
    expect(screen.getByRole('button', { name: /Nouvel atelier stratégique/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Importer un atelier/ })).toBeTruthy();
  });

  it('la création appelle creerAtelier puis ouvre l’atelier', async () => {
    charger();
    api.creerAtelier.mockResolvedValue({ id: 'a9', titre: 'Mon atelier', etat: { v: 1, step: 0 } });
    api.fetchAtelier.mockResolvedValue({
      id: 'a9',
      entrepriseId: 'e1',
      titre: 'Mon atelier',
      etat: { v: 1, step: 0 },
    });
    render(<Atelier slug="demo" />);
    fireEvent.click(await screen.findByRole('button', { name: '+ Nouveau' }));
    fireEvent.click(screen.getByRole('button', { name: /Nouvel atelier stratégique/ }));
    fireEvent.change(screen.getByLabelText('Nom de l’atelier'), {
      target: { value: 'Mon atelier' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Créer et ouvrir' }));
    await waitFor(() => expect(api.creerAtelier).toHaveBeenCalledWith('demo', 'e1', 'Mon atelier'));
    expect(await screen.findByText('Vue atelier a9')).toBeTruthy();
  });

  it('l’import lit le fichier et appelle importerAtelier', async () => {
    charger();
    api.importerAtelier.mockResolvedValue({ id: 'a8', titre: 'Repris', etat: { v: 1, step: 3 } });
    api.fetchAtelier.mockResolvedValue({
      id: 'a8',
      entrepriseId: 'e1',
      titre: 'Repris',
      etat: { v: 1, step: 3 },
    });
    render(<Atelier slug="demo" />);
    fireEvent.click(await screen.findByRole('button', { name: '+ Nouveau' }));
    fireEvent.click(screen.getByRole('button', { name: /Importer un atelier/ }));
    const sauvegarde = { v: 1, steps_state: { v: 1, step: 3 } };
    const fichier = new File([JSON.stringify(sauvegarde)], 'sauvegarde.json', {
      type: 'application/json',
    });
    fireEvent.change(screen.getByLabelText('Fichier de sauvegarde (.json)'), {
      target: { files: [fichier] },
    });
    fireEvent.change(screen.getByLabelText('Nom de l’atelier'), { target: { value: 'Repris' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Importer et ouvrir' }));
    await waitFor(() =>
      expect(api.importerAtelier).toHaveBeenCalledWith('demo', 'e1', 'Repris', sauvegarde),
    );
    expect(await screen.findByText('Vue atelier a8')).toBeTruthy();
  });

  it('un fichier illisible affiche l’erreur sans rien créer', async () => {
    charger();
    render(<Atelier slug="demo" />);
    fireEvent.click(await screen.findByRole('button', { name: '+ Nouveau' }));
    fireEvent.click(screen.getByRole('button', { name: /Importer un atelier/ }));
    const fichier = new File(['pas du json'], 'x.json', { type: 'application/json' });
    fireEvent.change(screen.getByLabelText('Fichier de sauvegarde (.json)'), {
      target: { files: [fichier] },
    });
    fireEvent.change(screen.getByLabelText('Nom de l’atelier'), { target: { value: 'X' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Importer et ouvrir' }));
    expect(await screen.findByText(/Fichier illisible/)).toBeTruthy();
    expect(api.importerAtelier).not.toHaveBeenCalled();
  });

  it('le module d’essai ouvre l’atelier sans appeler d’API d’écriture', async () => {
    charger();
    render(<Atelier slug="demo" />);
    fireEvent.click(await screen.findByRole('button', { name: /module d’essai/ }));
    expect(await screen.findByText('Vue essai')).toBeTruthy();
    expect(api.creerAtelier).not.toHaveBeenCalled();
    expect(api.importerAtelier).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '← Ateliers' }));
    expect(await screen.findByText('Entreprise Fictive A')).toBeTruthy();
  });

  it('la suppression demande confirmation', async () => {
    charger();
    api.supprimerAtelier.mockResolvedValue({ ok: true });
    const confirmation = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    render(<Atelier slug="demo" />);
    fireEvent.click(await screen.findByRole('button', { name: /Détail/ }));
    const supprimer = screen.getByRole('button', { name: 'Supprimer l’atelier' });
    fireEvent.click(supprimer);
    expect(api.supprimerAtelier).not.toHaveBeenCalled();
    fireEvent.click(supprimer);
    await waitFor(() => expect(api.supprimerAtelier).toHaveBeenCalledWith('demo', 'a1'));
    confirmation.mockRestore();
  });
});
