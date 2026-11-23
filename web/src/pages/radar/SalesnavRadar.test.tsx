// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PipeSalesnav, ProspectSalesnav, ReglagesSalesnav } from '../../api.js';

const api = vi.hoisted(() => ({
  fetchPipeSalesnav: vi.fn(),
  proposerSalesnav: vi.fn(),
  ajouterProspectSalesnav: vi.fn(),
  choisirCibleSalesnav: vi.fn(),
  actionProspectSalesnav: vi.fn(),
  fetchReglagesSalesnav: vi.fn(),
  enregistrerReglagesSalesnav: vi.fn(),
  enregistrerActionSalesnav: vi.fn(),
}));
vi.mock('../../api.js', () => api);
vi.mock('../SalesnavMessages.js', () => ({
  SalesnavMessages: () => <div>Éditeur de messages fictif</div>,
}));

import { SalesnavRadar } from './SalesnavRadar.js';

const reglages = (quotaJour = 8, pause = false): ReglagesSalesnav => ({
  quotaJour,
  quotaSemaine: quotaJour * 5,
  pause,
  quotaMax: 25,
  recommande: 8,
  cible: 12,
  niveau: 'normal',
});
const prospect = (
  id: string,
  statut: ProspectSalesnav['statut'],
  extra: Partial<ProspectSalesnav> = {},
): ProspectSalesnav => ({
  id,
  nom: `Personne ${id}`,
  fonction: 'Gérant',
  entreprise: `Atelier ${id}`,
  lienLinkedin: `https://www.linkedin.com/in/fictif-${id}`,
  cible: 'Cible fictive',
  statut,
  nbMessages: 0,
  opportuniteId: null,
  aRetirer: false,
  message: null,
  ...extra,
});
const pipe = (
  prospects: ProspectSalesnav[] = [],
  extra: Partial<PipeSalesnav> = {},
): PipeSalesnav => ({
  stats: {
    demandesEnvoyees: 20,
    acceptees: 9,
    tauxAcceptation: 45,
    messagesEnvoyes: 12,
    reponses: 3,
    tauxReponse: 33.3,
  },
  disponibles: 40,
  joursAvantRetrait: 21,
  cibles: ['Cible fictive'],
  prospects,
  ...extra,
});

describe('SalesnavRadar', () => {
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  const monter = async (p: PipeSalesnav = pipe(), r = reglages()) => {
    api.fetchPipeSalesnav.mockResolvedValue(p);
    api.fetchReglagesSalesnav.mockResolvedValue(r);
    const onRetour = vi.fn();
    render(<SalesnavRadar slug="demo" onRetour={onRetour} />);
    await screen.findByLabelText('Statistiques SalesNav');
    await waitFor(() => expect(api.fetchPipeSalesnav).toHaveBeenCalled());
    return { onRetour };
  };

  it('affiche les statistiques classiques d’une campagne', async () => {
    await monter();
    const stats = await screen.findByLabelText('Statistiques SalesNav');
    await waitFor(() => expect(within(stats).getByText('20')).toBeTruthy());
    expect(within(stats).getByText('Demandes envoyées')).toBeTruthy();
    expect(within(stats).getByText('45 %')).toBeTruthy();
    expect(within(stats).getByText('9 connexions')).toBeTruthy();
    expect(within(stats).getByText('12')).toBeTruthy();
    expect(within(stats).getByText('33,3 % des connectés')).toBeTruthy();
  });

  it('range les personnes dans les colonnes du pipe', async () => {
    await monter(
      pipe([
        prospect('a', 'propose'),
        prospect('b', 'demande_envoyee'),
        prospect('c', 'connecte'),
        prospect('d', 'a_repondu'),
        prospect('e', 'sans_reponse'),
      ]),
    );
    for (const [colonne, nom] of [
      ['Proposés', 'Personne a'],
      ['Demande envoyée', 'Personne b'],
      ['Connectés', 'Personne c'],
      ['Ont répondu', 'Personne d'],
      ['Sans réponse', 'Personne e'],
    ] as const) {
      const c = await screen.findByRole('region', { name: colonne });
      expect(within(c).getByText(nom)).toBeTruthy();
    }
  });

  it('propose les profils du jour et dit combien il en manque', async () => {
    await monter();
    api.proposerSalesnav.mockResolvedValue({ proposes: 7, manque: 3 });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Proposer des profils pour aujourd’hui' }),
    );
    expect(await screen.findByText(/7 profils proposés\. Il en manque 3/)).toBeTruthy();
    expect(screen.getByText('40 disponibles dans la Base des suspects')).toBeTruthy();
  });

  it('affiche le message à envoyer, le copie, et signale ce qui manque', async () => {
    const ecrire = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: ecrire } });
    await monter(
      pipe([
        prospect('a', 'propose', {
          message: {
            etape: 'invitation',
            texte: 'Bonjour Alex, chez Atelier a ?',
            manquantes: [],
            longueur: 30,
          },
        }),
        prospect('b', 'connecte', {
          message: {
            etape: 'acceptation',
            texte: 'Merci {prénom}.',
            manquantes: ['prenom'],
            longueur: 15,
          },
        }),
      ]),
    );
    expect(await screen.findByText('Note d’invitation')).toBeTruthy();
    expect(screen.getByText('À compléter : prenom.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copier le message pour Personne a' }));
    await waitFor(() => expect(ecrire).toHaveBeenCalledWith('Bonjour Alex, chez Atelier a ?'));
  });

  it('suit une personne : demande envoyée, connectée, message, réponse', async () => {
    api.actionProspectSalesnav.mockResolvedValue({ ok: true, opportuniteCreee: false });
    await monter(
      pipe([prospect('a', 'propose'), prospect('b', 'demande_envoyee'), prospect('c', 'connecte')]),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Demande envoyée' }));
    await waitFor(() =>
      expect(api.actionProspectSalesnav).toHaveBeenCalledWith('demo', 'a', 'demande'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Connecté(e)' }));
    await waitFor(() =>
      expect(api.actionProspectSalesnav).toHaveBeenCalledWith('demo', 'b', 'connecte'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Message envoyé' }));
    await waitFor(() =>
      expect(api.actionProspectSalesnav).toHaveBeenCalledWith('demo', 'c', 'message'),
    );
  });

  it('annonce l’opportunité créée dans le Radar à la première réponse', async () => {
    api.actionProspectSalesnav.mockResolvedValue({ ok: true, opportuniteCreee: true });
    await monter(pipe([prospect('c', 'connecte')]));
    fireEvent.click(await screen.findByRole('button', { name: 'A répondu' }));
    expect(await screen.findByText(/une opportunité a été créée dans le Radar/)).toBeTruthy();
    expect(api.actionProspectSalesnav).toHaveBeenCalledWith('demo', 'c', 'reponse');
  });

  it('range sans réponse, écarte, et signale les demandes à retirer', async () => {
    api.actionProspectSalesnav.mockResolvedValue({ ok: true, opportuniteCreee: false });
    await monter(
      pipe([prospect('a', 'propose'), prospect('b', 'demande_envoyee', { aRetirer: true })]),
    );
    expect(await screen.findByText('À retirer', { selector: 'span.chip' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sans réponse' }));
    await waitFor(() =>
      expect(api.actionProspectSalesnav).toHaveBeenCalledWith('demo', 'b', 'sans-reponse'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Écarter' }));
    await waitFor(() =>
      expect(api.actionProspectSalesnav).toHaveBeenCalledWith('demo', 'a', 'ecarter'),
    );
  });

  it('affiche le refus du quota', async () => {
    api.actionProspectSalesnav.mockRejectedValue(new Error('Quota atteint : 8 demandes par jour.'));
    await monter(pipe([prospect('a', 'propose')]));
    fireEvent.click(await screen.findByRole('button', { name: 'Demande envoyée' }));
    expect(await screen.findByText(/Quota atteint/)).toBeTruthy();
  });

  it('choisit la cible des messages d’une personne', async () => {
    api.choisirCibleSalesnav.mockResolvedValue({ ok: true });
    await monter(pipe([prospect('a', 'propose', { cible: null })]));
    fireEvent.change(await screen.findByLabelText('Cible de Personne a'), {
      target: { value: 'Cible fictive' },
    });
    await waitFor(() =>
      expect(api.choisirCibleSalesnav).toHaveBeenCalledWith('demo', 'a', 'Cible fictive'),
    );
  });

  it('ajoute un profil par son lien', async () => {
    api.ajouterProspectSalesnav.mockResolvedValue({ id: 'n' });
    await monter();
    fireEvent.click(await screen.findByRole('button', { name: 'Ajouter un profil' }));
    fireEvent.change(screen.getByLabelText('Lien du profil'), {
      target: { value: 'https://www.linkedin.com/in/nouveau-fictif' },
    });
    fireEvent.change(screen.getByLabelText('Nom de la personne'), {
      target: { value: 'Alex Fictif' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }));
    await waitFor(() =>
      expect(api.ajouterProspectSalesnav).toHaveBeenCalledWith('demo', {
        lien: 'https://www.linkedin.com/in/nouveau-fictif',
        nom: 'Alex Fictif',
      }),
    );
  });

  it('règle le quota avec le curseur, avertit au-delà de 15 et met en pause', async () => {
    await monter();
    api.enregistrerReglagesSalesnav.mockResolvedValue(reglages(10));
    const curseur = await screen.findByLabelText('Demandes par jour');
    fireEvent.change(curseur, { target: { value: '16' } });
    expect(screen.getByRole('alert').textContent).toMatch(/Au-delà de 15 demandes/);
    fireEvent.change(curseur, { target: { value: '21' } });
    expect(screen.getByRole('alert').textContent).toMatch(/Plus de 20 demandes/);
    fireEvent.change(curseur, { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le quota' }));
    await waitFor(() =>
      expect(api.enregistrerReglagesSalesnav).toHaveBeenCalledWith('demo', { quotaJour: 10 }),
    );
    fireEvent.click(screen.getByLabelText('Mettre le canal en pause'));
    await waitFor(() =>
      expect(api.enregistrerReglagesSalesnav).toHaveBeenCalledWith('demo', { pause: true }),
    );
  });

  it('ouvre les messages dans une fenêtre, sans les mettre au bas de la page', async () => {
    const { onRetour } = await monter();
    expect(screen.queryByText('Éditeur de messages fictif')).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Messages' }));
    expect(await screen.findByText('Éditeur de messages fictif')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '← Retour au Radar' }));
    expect(onRetour).toHaveBeenCalled();
  });

  it('note une demande de connexion reçue', async () => {
    api.enregistrerActionSalesnav.mockResolvedValue({});
    await monter();
    fireEvent.click(await screen.findByRole('button', { name: '+ Demande reçue' }));
    await waitFor(() =>
      expect(api.enregistrerActionSalesnav).toHaveBeenCalledWith('demo', { type: 'demande_recue' }),
    );
    expect(await screen.findByText('Demande reçue enregistrée.')).toBeTruthy();
  });
});
