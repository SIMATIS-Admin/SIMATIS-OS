// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AtelierListe, Entreprise } from '../api.js';
import { Atelier } from './Atelier.js';

const api = vi.hoisted(() => ({
  fetchEntreprises: vi.fn(),
  fetchFiche: vi.fn(),
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
const charger = (opts: { e?: Entreprise[]; a?: AtelierListe[]; contacts?: unknown[] } = {}) => {
  api.fetchEntreprises.mockResolvedValue(opts.e ?? [entreprise(1)]);
  api.fetchAteliers.mockResolvedValue(opts.a ?? [atelier(1)]);
  api.fetchFiche.mockResolvedValue({ liens: { contacts: opts.contacts ?? [] } });
};

describe('Atelier : accueil de la section', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('affiche la pastille Bêta et ne liste que les entreprises qui ont un atelier', async () => {
    charger({ e: [entreprise(1), entreprise(2)], a: [atelier(1)] });
    render(<Atelier slug="demo" />);
    await screen.findByText('Entreprise Fictive A');
    expect(screen.getAllByText('Bêta').length).toBeGreaterThan(0);
    expect(screen.queryByText('Entreprise Fictive B')).toBeNull();
    expect(document.querySelectorAll('.dg-ligne')).toHaveLength(1);
  });

  it('ne parle ni de diagnostic ni de test VMA', async () => {
    charger();
    render(<Atelier slug="demo" />);
    fireEvent.click(await screen.findByRole('button', { name: /Détail/ }));
    expect(screen.queryByText(/Diagnostic/)).toBeNull();
    expect(screen.queryByText(/VMA/)).toBeNull();
    expect(screen.queryByRole('link', { name: /Outils et diagnostics/ })).toBeNull();
    expect(api.fetchEntreprises).toHaveBeenCalled();
  });

  it('résume les ateliers de la ligne : nombre, dernière modification, avancement', async () => {
    charger({
      a: [atelier(1), atelier(1, { id: 'a2', updatedAt: '2026-10-28T10:00:00Z', etapeMax: 2 })],
    });
    render(<Atelier slug="demo" />);
    const ligne = (await screen.findByText('Entreprise Fictive A')).closest(
      '.dg-ligne',
    ) as HTMLElement;
    expect(within(ligne).getByText('2')).toBeTruthy();
    expect(within(ligne).getByText('28/10/2026')).toBeTruthy();
    expect(within(ligne).getByText('Étape 2 sur 6')).toBeTruthy();
  });

  it('le détail liste les ateliers et renvoie vers la fiche de l’entreprise et son contact', async () => {
    charger({ contacts: [{ id: 'c1', nom: 'Dirigeant Fictif', principal: true }] });
    render(<Atelier slug="demo" />);
    fireEvent.click(await screen.findByRole('button', { name: /Détail/ }));
    expect(screen.getByText('Atelier fictif 1')).toBeTruthy();
    expect(screen.getByText(/14 actions/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Fiche entreprise' }).getAttribute('href')).toBe(
      '#/demo/fiche/entreprise/e1',
    );
    expect(await screen.findByRole('link', { name: 'Fiche contact' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Fiche contact' }).getAttribute('href')).toBe(
      '#/demo/fiche/contact/c1',
    );
  });

  it('sans contact, pas de lien vers une fiche contact', async () => {
    charger();
    render(<Atelier slug="demo" />);
    fireEvent.click(await screen.findByRole('button', { name: /Détail/ }));
    await waitFor(() => expect(api.fetchFiche).toHaveBeenCalledWith('demo', 'entreprise', 'e1'));
    expect(screen.queryByRole('link', { name: 'Fiche contact' })).toBeNull();
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
