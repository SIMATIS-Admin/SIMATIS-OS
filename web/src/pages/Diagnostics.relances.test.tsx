// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entreprise, TestVma } from '../api.js';
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
    relancerTestVma: vi.fn(),
    creerTestVma: vi.fn(),
    createEntreprise: vi.fn(),
  };
});
vi.mock('../api.js', () => api);

const entreprise = (id: string, nom: string): Entreprise =>
  ({ id, nom, secteur: null, ville: null, taille: null, domaine: null }) as Entreprise;

const JOUR = 24 * 3600 * 1000;
const il = (jours: number) => new Date(Date.now() - jours * JOUR).toISOString();

const test = (extra: Partial<TestVma>): TestVma =>
  ({
    id: 't1',
    entrepriseId: 'e1',
    entrepriseNom: 'Entreprise Fictive A',
    contactNom: 'Jeanne',
    contactEmail: 'jeanne@exemple.test',
    tutoiement: false,
    envoyeeLe: il(10),
    relances: [],
    echecEnvoi: null,
    type: 'essai',
    statut: 'envoyee',
    lien: 'https://exemple.invalid/vma/t1',
    expireLe: '2099-01-01T00:00:00Z',
    creeLe: il(10),
    recueLe: null,
    resultat: null,
    ...extra,
  }) as TestVma;

const afficher = async (
  tests: TestVma[],
  entreprises = [entreprise('e1', 'Entreprise Fictive A')],
) => {
  api.fetchEntreprises.mockResolvedValue(entreprises);
  api.fetchProjetsDiag.mockResolvedValue([]);
  api.fetchTestsVma.mockResolvedValue(tests);
  render(<Diagnostics slug="demo" />);
  for (const bouton of await screen.findAllByRole('button', { name: /Détail/ })) {
    fireEvent.click(bouton);
  }
};

describe('Diagnostics : relances et suivi des invitations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });
  afterEach(() => cleanup());

  it('conserve un bloc archivé après réouverture et permet de le restaurer', async () => {
    await afficher([test({})]);
    fireEvent.click(screen.getByRole('button', { name: 'Archiver ce bloc' }));
    expect(screen.queryByText('Entreprise Fictive A')).toBeNull();

    cleanup();
    render(<Diagnostics slug="demo" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Archives (1)' }));
    fireEvent.click(screen.getByRole('button', { name: /Entreprise Fictive A.*Détail/ }));
    expect(screen.getByText('jeanne@exemple.test')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Restaurer ce bloc' }));
    expect(screen.getByText('Aucun bloc archivé.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retour aux blocs actifs' }));
    expect(screen.getByText('Entreprise Fictive A')).toBeTruthy();
  });

  it('archive un seul test et laisse les autres tests du bloc visibles', async () => {
    await afficher([
      test({ id: 't1', contactNom: 'Premier destinataire' }),
      test({ id: 't2', contactNom: 'Second destinataire' }),
    ]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Archiver ce test' })[0]!);
    expect(screen.queryByText('Premier destinataire')).toBeNull();
    expect(screen.getByText('Second destinataire')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Archives (1)' }));
    expect(screen.getByText('Premier destinataire')).toBeTruthy();
    expect(screen.queryByText('Second destinataire')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Restaurer ce bloc' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Restaurer ce test' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retour aux blocs actifs' }));
    expect(screen.getByText('Premier destinataire')).toBeTruthy();
    expect(screen.getByText('Second destinataire')).toBeTruthy();
  });

  it('montre les cinq étapes de la frise avec les étapes à venir', async () => {
    await afficher([test({ relances: [{ le: il(3), origine: 'auto' }] })]);
    const jour = (iso: string) =>
      new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
    expect(screen.getByText('Envoyé')).toBeTruthy();
    expect(screen.getByText(jour(il(10)))).toBeTruthy();
    expect(screen.getByText(jour(il(3)))).toBeTruthy();
    expect(screen.getByText('Résultat reçu')).toBeTruthy();
    expect(document.querySelectorAll('.frise > li')).toHaveLength(5);
    expect(document.querySelectorAll('.frise > .a-venir')).toHaveLength(3);
  });

  it('un résultat reçu retire les actions d’invitation, même avec le statut envoyée', async () => {
    await afficher([test({ recueLe: il(1) })]);
    expect(screen.getByText('Terminé')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Relancer' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copier le lien' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Révoquer' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Supprimer le test' })).toBeTruthy();
  });

  it('distingue deux destinataires de la même entreprise par nom et adresse', async () => {
    await afficher([
      test({ id: 'a', contactNom: 'Jeanne Exemple', contactEmail: 'jeanne@exemple.test' }),
      test({ id: 'b', contactNom: 'Paul Exemple', contactEmail: 'paul@exemple.test' }),
    ]);
    expect(screen.getByText('Jeanne Exemple')).toBeTruthy();
    expect(screen.getByText('Paul Exemple')).toBeTruthy();
    expect(screen.getByText('jeanne@exemple.test')).toBeTruthy();
    expect(screen.getByText('paul@exemple.test')).toBeTruthy();
  });

  it('affiche la raison du dernier envoi en échec', async () => {
    await afficher([test({ echecEnvoi: 'boîte hors ligne' })]);
    expect(screen.getByText(/Dernier envoi en échec : boîte hors ligne/)).toBeTruthy();
  });

  it('propose Relancer seulement pour une invitation ouverte avec une adresse', async () => {
    await afficher([
      test({ id: 'a' }),
      test({ id: 'b', statut: 'utilisee', recueLe: il(1) }),
      test({ id: 'c', contactEmail: null }),
      test({ id: 'd', expireLe: il(1) }),
    ]);
    expect(screen.getAllByRole('button', { name: 'Relancer' })).toHaveLength(1);
  });

  it('relancer préremplit « Tutoyer » depuis l’invitation, envoie le choix et ferme la fenêtre', async () => {
    api.relancerTestVma.mockResolvedValue({
      ...test({ tutoiement: false }),
      envoi: { statut: 'envoye' },
    });
    await afficher([test({ tutoiement: true })]);
    fireEvent.click(screen.getByRole('button', { name: 'Relancer' }));
    const tu = screen.getByLabelText<HTMLInputElement>('Tutoyer pour cette relance');
    expect(tu.checked).toBe(true);
    fireEvent.click(tu);
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer la relance' }));
    await waitFor(() => expect(api.relancerTestVma).toHaveBeenCalledWith('demo', 't1', false));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Envoyer la relance' })).toBeNull(),
    );
    expect(screen.queryByText(/Relance envoyée à/)).toBeNull();
  });

  it('une simulation ferme la fenêtre sans afficher de bandeau', async () => {
    api.relancerTestVma.mockResolvedValue({ ...test({}), envoi: { statut: 'simule' } });
    await afficher([test({})]);
    fireEvent.click(screen.getByRole('button', { name: 'Relancer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer la relance' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Envoyer la relance' })).toBeNull(),
    );
    expect(screen.queryByText(/Relance non envoyée/)).toBeNull();
  });

  it('« Annuler » ne relance rien', async () => {
    await afficher([test({})]);
    fireEvent.click(screen.getByRole('button', { name: 'Relancer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(api.relancerTestVma).not.toHaveBeenCalled();
  });

  it('un refus de l’API s’affiche', async () => {
    api.relancerTestVma.mockRejectedValue(new api.ApiError('Invitation expirée', 409, {}));
    await afficher([test({})]);
    fireEvent.click(screen.getByRole('button', { name: 'Relancer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer la relance' }));
    await waitFor(() => expect(screen.getByText('Invitation expirée')).toBeTruthy());
  });

  it('le filtre « Sans réponse » ne garde que les entreprises à relancer', async () => {
    await afficher(
      [
        test({ id: 'a', entrepriseId: 'e1', entrepriseNom: 'Entreprise Fictive A' }),
        test({
          id: 'b',
          entrepriseId: 'e2',
          entrepriseNom: 'Entreprise Fictive B',
          envoyeeLe: il(2),
        }),
      ],
      [entreprise('e1', 'Entreprise Fictive A'), entreprise('e2', 'Entreprise Fictive B')],
    );
    expect(screen.getByText('Entreprise Fictive B')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Sans réponse depuis plus de 7 jours'));
    expect(screen.queryByText('Entreprise Fictive B')).toBeNull();
    expect(screen.getByText('Entreprise Fictive A')).toBeTruthy();
  });

  it('la case « Tutoyer le dirigeant » du nouveau test part avec l’invitation', async () => {
    api.createEntreprise.mockResolvedValue({ id: 'e9' });
    api.creerTestVma.mockResolvedValue({ ...test({}), envoi: null });
    api.fetchEntreprises.mockResolvedValue([]);
    api.fetchProjetsDiag.mockResolvedValue([]);
    api.fetchTestsVma.mockResolvedValue([]);
    render(<Diagnostics slug="demo" />);
    await screen.findByText('Aucun bloc actif.');
    fireEvent.click(screen.getByRole('button', { name: '+ Nouveau' }));
    fireEvent.click(screen.getByRole('button', { name: /Nouveau test VMA/ }));
    const tu = screen.getByLabelText<HTMLInputElement>('Tutoyer le dirigeant');
    expect(tu.checked).toBe(false);
    fireEvent.change(screen.getByLabelText('Nom de l’entreprise (nouvelle)'), {
      target: { value: 'Entreprise Fictive N' },
    });
    fireEvent.change(screen.getByLabelText('Dirigeant qui passe le test'), {
      target: { value: 'Dirigeant Fictif' },
    });
    fireEvent.change(screen.getByLabelText('E-mail du dirigeant'), {
      target: { value: 'd@exemple.invalid' },
    });
    fireEvent.click(tu);
    fireEvent.click(screen.getByRole('button', { name: 'Créer l’invitation' }));
    await waitFor(() => expect(api.creerTestVma).toHaveBeenCalledTimes(1));
    expect(api.creerTestVma.mock.calls[0]?.[1]).toMatchObject({ tutoiement: true });
  });
});
