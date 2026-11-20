// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  fetchPipeline: vi.fn(),
  fetchTaches: vi.fn(),
  updateTache: vi.fn(),
  createTache: vi.fn(),
  fetchMasqueesRelance: vi.fn(),
  masquerRelance: vi.fn(),
  masquerRelanceLot: vi.fn(),
  fetchBrouillonsPrepares: vi.fn(),
  decider: vi.fn(),
  fetchProspection: vi.fn(),
  fetchMailsFiche: vi.fn(),
  envoyerMailRelanceProspection: vi.fn(),
}));
vi.mock('../api.js', () => api);

import { AideRelance } from './AideRelance.js';

const opp = (id: number, extra: Record<string, unknown> = {}) => ({
  id: `o${id}`,
  titre: `Affaire ${id}`,
  etape: 'proposition',
  clos: null,
  montant: null,
  entreprise: `Société fictive ${id}`,
  contact: 'Camille Exemple',
  derniereActivite: null,
  joursInactif: 30 + id,
  radar: null,
  tentatives: 0,
  radarEtapeManuelle: null,
  ...extra,
});

const tacheRetard = {
  id: 't1',
  titre: 'Relancer le devis',
  canal: 'email',
  type: 'email',
  fait: false,
  // En retard de trois jours : plus récent que le seuil des tâches périmées.
  echeance: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  contact: { id: 'c1', nom: 'Dana Imaginaire', email: 'dana@exemple.test' },
  entreprise: { id: 'e1', nom: 'Retard Fictif' },
  opportunite: { id: 'o99', titre: 'Devis', clos: null },
};

describe('AideRelance', () => {
  beforeEach(() => {
    localStorage.clear();
    // Le bloc est replié par défaut : les essais de la liste le déplient d'avance.
    localStorage.setItem('aideRelance:deploye', 'true');
    api.fetchPipeline.mockResolvedValue({
      etapes: [
        { id: 'detection', label: 'Détection' },
        { id: 'prospection', label: 'Prospection' },
        { id: 'proposition', label: 'Proposition' },
      ],
      inactiviteJours: 14,
      opportunites: Array.from({ length: 12 }, (_, i) => opp(i + 1)),
    });
    api.fetchTaches.mockResolvedValue({ enRetard: [tacheRetard] });
    api.updateTache.mockResolvedValue({});
    api.createTache.mockResolvedValue({});
    api.fetchMasqueesRelance.mockResolvedValue({});
    api.masquerRelance.mockResolvedValue({});
    api.masquerRelanceLot.mockResolvedValue({});
    api.fetchBrouillonsPrepares.mockResolvedValue([]);
    api.fetchProspection.mockResolvedValue({
      signatures: [
        { id: 's0', nom: 'Courte', defaut: false, typeMime: 'image/png' },
        { id: 's1', nom: 'Marc', defaut: true, typeMime: 'image/png' },
      ],
    });
    api.fetchMailsFiche.mockResolvedValue({ mails: [], adresses: 1 });
    api.envoyerMailRelanceProspection.mockResolvedValue({ simulation: false });
  });
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it("montre autant d'actions que choisi, retient le choix et signale le reste en attente", async () => {
    render(<AideRelance slug="simatis" />);
    expect(await screen.findByText('Retard Fictif')).toBeTruthy();
    // 13 actions possibles, 10 affichées par défaut.
    expect(screen.getAllByRole('button', { name: /Ouvrir/ })).toHaveLength(10);
    expect(screen.getByText(/\+ 3 autre\(s\) en attente/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '5' }));
    expect(screen.getAllByRole('button', { name: /Ouvrir/ })).toHaveLength(5);
    expect(localStorage.getItem('aideRelance:nb')).toBe('5');

    cleanup();
    render(<AideRelance slug="simatis" />);
    await screen.findByText('Retard Fictif');
    expect(screen.getAllByRole('button', { name: /Ouvrir/ })).toHaveLength(5);

    fireEvent.click(screen.getByRole('button', { name: 'Tout' }));
    expect(screen.getAllByRole('button', { name: /Ouvrir/ })).toHaveLength(13);
  });

  it('est replié par défaut sur une ligne, se déplie et retient son état', async () => {
    localStorage.clear();
    render(<AideRelance slug="simatis" />);
    await screen.findByText(/13 action\(s\) possible\(s\)/);
    expect(screen.queryByRole('button', { name: /Retard Fictif/ })).toBeNull();
    const bascule = screen.getByRole('button', { name: /À faire maintenant/ });
    expect(bascule.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(bascule);
    expect(await screen.findByRole('button', { name: /Retard Fictif/ })).toBeTruthy();
    expect(localStorage.getItem('aideRelance:deploye')).toBe('true');

    cleanup();
    render(<AideRelance slug="simatis" />);
    expect(await screen.findByRole('button', { name: /Retard Fictif/ })).toBeTruthy();
  });

  it('filtre par source', async () => {
    render(<AideRelance slug="simatis" />);
    await screen.findByText('Retard Fictif');
    fireEvent.click(screen.getByRole('button', { name: /^En retard \(1\)/ }));
    expect(screen.getAllByRole('button', { name: /Ouvrir/ })).toHaveLength(1);
  });

  it('ouvre le mail préparé au prénom seul, puis « Mail envoyé » crée la suite et clôt la tâche', async () => {
    render(<AideRelance slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Retard Fictif/ }));
    const corps = await screen.findByLabelText<HTMLTextAreaElement>(/Mail préparé/);
    expect(corps.value.startsWith('Bonjour Dana,')).toBe(true);
    expect(screen.getByRole('link', { name: /Ouvrir dans ma messagerie/ })).toBeTruthy();

    // Déjà envoyé de son côté : l'action est close et la première suite planifiée, sans écran de choix.
    fireEvent.click(screen.getByRole('button', { name: 'Mail envoyé' }));

    await waitFor(() =>
      expect(api.updateTache).toHaveBeenCalledWith('simatis', 't1', { fait: true }),
    );
    expect(api.createTache).toHaveBeenCalledWith(
      'simatis',
      expect.objectContaining({
        type: 'appel',
        entrepriseId: 'e1',
        contactId: 'c1',
        opportuniteId: 'o99',
        hubspot: false,
      }),
    );
    await waitFor(() => expect(screen.queryByRole('button', { name: /Retard Fictif/ })).toBeNull());
    expect(screen.getByText(/1 faite\(s\) aujourd'hui/)).toBeTruthy();
  });

  it('écarte une action pour de bon, côté serveur, et ne la repropose plus', async () => {
    render(<AideRelance slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Retard Fictif/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Pas pertinent' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Retard Fictif/ })).toBeNull());
    expect(api.updateTache).not.toHaveBeenCalled();
    expect(api.masquerRelance).toHaveBeenCalledWith('simatis', 'ent:retard fictif', 8.64e15);

    // Au chargement suivant, le serveur redonne l'écart : la ligne ne revient pas.
    api.fetchMasqueesRelance.mockResolvedValue({ 'ent:retard fictif': 8.64e15 });
    cleanup();
    render(<AideRelance slug="simatis" />);
    await screen.findByText(/Société fictive 12/);
    expect(screen.queryByText('Retard Fictif')).toBeNull();
  });

  it('lance une séquence dans la limite choisie et passe les actions une par une', async () => {
    render(<AideRelance slug="simatis" />);
    await screen.findByText('Retard Fictif');
    fireEvent.click(screen.getByRole('button', { name: '5' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lancer la séquence' }));

    let volet = await screen.findByRole('dialog');
    expect(within(volet).getByText(/Action 1 sur 5/)).toBeTruthy();

    // Passer ne cache rien et ne clôt aucune tâche : on voit l'action suivante.
    fireEvent.click(within(volet).getByRole('button', { name: 'Passer' }));
    volet = await screen.findByRole('dialog');
    expect(within(volet).getByText(/Action 2 sur 5/)).toBeTruthy();
    expect(api.masquerRelance).not.toHaveBeenCalled();
    expect(api.updateTache).not.toHaveBeenCalled();

    // Reporter cache l'action côté serveur puis passe à la suivante.
    fireEvent.click(within(volet).getByRole('button', { name: 'Demain' }));
    volet = await screen.findByRole('dialog');
    expect(within(volet).getByText(/Action 3 sur 5/)).toBeTruthy();
    expect(api.masquerRelance).toHaveBeenCalledTimes(1);

    // Le reste est passé : bilan de fin.
    for (let i = 0; i < 3; i++)
      fireEvent.click(
        within(await screen.findByRole('dialog')).getByRole('button', { name: 'Passer' }),
      );
    expect(await screen.findByText('Séquence terminée')).toBeTruthy();
    expect(screen.getByText(/5 action\(s\) passées en revue/)).toBeTruthy();
  });

  it("n'offre pas de séquence quand il n'y a rien à faire", async () => {
    api.fetchPipeline.mockResolvedValue({ etapes: [], inactiviteJours: 14, opportunites: [] });
    api.fetchTaches.mockResolvedValue({ enRetard: [] });
    render(<AideRelance slug="simatis" />);
    await screen.findByText(/La liste est vide/);
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Lancer la séquence' }).disabled,
    ).toBe(true);
  });

  it("filtre par mandat comme dans l'Agenda et retient les mandats décochés", async () => {
    api.fetchTaches.mockResolvedValue({
      enRetard: [
        { ...tacheRetard, instance: { slug: 'simatis', nom: 'SIMATIS', couleur: null } },
        {
          ...tacheRetard,
          id: 't9',
          entreprise: { id: 'e9', nom: 'Autre Mandat Fictif' },
          instance: { slug: 'mandat-b', nom: 'Mandat B', couleur: null },
        },
      ],
      instances: [
        { slug: 'simatis', nom: 'SIMATIS', couleur: null },
        { slug: 'mandat-b', nom: 'Mandat B', couleur: null },
      ],
    });
    render(<AideRelance slug="simatis" />);
    expect(await screen.findByText('Autre Mandat Fictif')).toBeTruthy();
    expect(screen.getByText('Retard Fictif')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Mandat B'));
    await waitFor(() => expect(screen.queryByText('Autre Mandat Fictif')).toBeNull());
    expect(screen.getByText('Retard Fictif')).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('aideRelance.instances-masquees') ?? '[]')).toEqual([
      'mandat-b',
    ]);

    cleanup();
    render(<AideRelance slug="simatis" />);
    await screen.findByText('Retard Fictif');
    expect(screen.queryByText('Autre Mandat Fictif')).toBeNull();
  });

  it("écrit dans le mandat de l'action quand elle vient d'un autre mandat", async () => {
    api.fetchTaches.mockResolvedValue({
      enRetard: [
        { ...tacheRetard, instance: { slug: 'mandat-b', nom: 'Mandat B', couleur: null } },
      ],
      instances: [
        { slug: 'simatis', nom: 'SIMATIS', couleur: null },
        { slug: 'mandat-b', nom: 'Mandat B', couleur: null },
      ],
    });
    render(<AideRelance slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Retard Fictif/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Mail envoyé' }));
    await waitFor(() =>
      expect(api.updateTache).toHaveBeenCalledWith('mandat-b', 't1', { fait: true }),
    );
    expect(api.createTache).toHaveBeenCalledWith('mandat-b', expect.anything());
  });

  it('affiche la file même si les reports ou les brouillons préparés sont indisponibles', async () => {
    api.fetchMasqueesRelance.mockRejectedValue(new Error('indisponible'));
    api.fetchBrouillonsPrepares.mockRejectedValue(new Error('indisponible'));
    render(<AideRelance slug="simatis" />);
    expect(await screen.findByText('Retard Fictif')).toBeTruthy();
  });

  it('montre le brouillon préparé par la routine et le dépose dans la messagerie sans rien envoyer', async () => {
    api.fetchBrouillonsPrepares.mockResolvedValue([
      {
        id: 'p1',
        type: 'email.brouillon',
        statut: 'proposee',
        contenu: {
          tacheId: 't1',
          contactId: 'c1',
          objet: 'Objet préparé',
          corps: '<p>Bonjour Dana,</p><p>Voici trois créneaux&nbsp;: mardi, jeudi.</p>',
        },
      },
    ]);
    api.decider.mockResolvedValue({ statut: 'appliquee', resultat: { simulation: true } });
    render(<AideRelance slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Retard Fictif/ }));
    const texte = await screen.findByLabelText<HTMLTextAreaElement>(/Mail préparé par la routine/);
    expect(texte.value).toContain('Bonjour Dana,');
    expect(texte.value).toContain('créneaux : mardi, jeudi.');
    expect(api.decider).not.toHaveBeenCalled();

    api.envoyerMailRelanceProspection.mockResolvedValue({ simulation: true });
    fireEvent.click(screen.getByRole('button', { name: 'Créer le brouillon Gmail' }));
    await waitFor(() =>
      expect(api.envoyerMailRelanceProspection).toHaveBeenCalledWith(
        'simatis',
        expect.objectContaining({ mode: 'brouillon', objet: 'Objet préparé', signatureId: 's1' }),
      ),
    );
    expect(await screen.findByText(/Brouillon simulé/)).toBeTruthy();
    // Rien n'a été écrit : la proposition de la routine reste à sa place.
    expect(api.decider).not.toHaveBeenCalled();
  });

  describe('envoi direct depuis la séquence', () => {
    const lancer = async () => {
      render(<AideRelance slug="simatis" />);
      await screen.findByText('Retard Fictif');
      fireEvent.click(screen.getByRole('button', { name: 'Lancer la séquence' }));
      return screen.findByRole('dialog');
    };

    it("montre la jauge d'avancement et la fait progresser", async () => {
      let volet = await lancer();
      const jauge = () => within(volet).getByRole('progressbar');
      expect(jauge().getAttribute('aria-valuenow')).toBe('0');
      expect(jauge().getAttribute('aria-valuemax')).toBe('10');
      fireEvent.click(within(volet).getByRole('button', { name: 'Passer' }));
      volet = await screen.findByRole('dialog');
      expect(within(volet).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('1');
    });

    it("sépare l'action et la situation, avec le dernier mail envoyé et la réponse reçue", async () => {
      api.fetchMailsFiche.mockResolvedValue({
        adresses: 1,
        mails: [
          {
            id: 'm1',
            type: 'email',
            titre: null,
            texte: null,
            at: '2026-11-10T09:00:00Z',
            origine: 'os',
            mail: {
              fil: 'fil-1',
              objet: 'Notre échange',
              de: 'moi',
              a: 'dana',
              sens: 'envoye',
              reponse: false,
              corps: 'Texte du mail envoyé',
            },
          },
          {
            id: 'm2',
            type: 'email',
            titre: null,
            texte: null,
            at: '2026-11-12T09:00:00Z',
            origine: 'os',
            mail: {
              fil: 'fil-1',
              objet: 'Re: Notre échange',
              de: 'dana',
              a: 'moi',
              sens: 'recu',
              reponse: true,
              corps: 'Texte de la réponse',
            },
          },
        ],
      });
      const volet = await lancer();
      expect(within(volet).getByLabelText("L'action")).toBeTruthy();
      const situation = within(volet).getByLabelText('Situation et historique');
      expect(await within(situation).findByText('Texte de la réponse')).toBeTruthy();
      expect(within(situation).getByText(/Votre dernier mail/)).toBeTruthy();
      expect(api.fetchMailsFiche).toHaveBeenCalledWith('simatis', 'contact', 'c1');
    });

    it('explique ce que fait « Pas pertinent »', async () => {
      const volet = await lancer();
      expect(
        within(volet).getByRole('button', { name: 'Pas pertinent' }).getAttribute('title'),
      ).toMatch(/pour toujours.*CRM ne sont pas modifiés/);
    });

    it("envoie le mail avec la signature par défaut, clôt l'action et passe à la suivante", async () => {
      api.fetchMailsFiche.mockResolvedValue({
        adresses: 1,
        mails: [
          {
            id: 'm1',
            type: 'email',
            titre: null,
            texte: null,
            at: '2026-11-10T09:00:00Z',
            origine: 'os',
            mail: { fil: 'fil-1', objet: 'x', de: null, a: null, sens: 'envoye', reponse: false },
          },
        ],
      });
      const volet = await lancer();
      await within(volet).findByText(/Notre échange|1 mail/);
      expect(
        within(volet).getByRole<HTMLSelectElement>('combobox', { name: 'Signature' }).value,
      ).toBe('s1');
      fireEvent.click(within(volet).getByRole('button', { name: /Envoyer le mail/ }));
      await waitFor(() =>
        expect(api.envoyerMailRelanceProspection).toHaveBeenCalledWith(
          'simatis',
          expect.objectContaining({
            mode: 'envoi',
            to: 'dana@exemple.test',
            signatureId: 's1',
            threadId: 'fil-1',
          }),
        ),
      );
      await waitFor(() =>
        expect(api.updateTache).toHaveBeenCalledWith('simatis', 't1', { fait: true }),
      );
      expect(api.createTache).toHaveBeenCalledWith(
        'simatis',
        expect.objectContaining({ type: 'appel', hubspot: false }),
      );
      expect(await screen.findByText(/Action 2 sur/)).toBeTruthy();
    });

    it('ne clôture rien quand l’envoi est simulé ou échoue', async () => {
      api.envoyerMailRelanceProspection.mockResolvedValueOnce({ simulation: true });
      const volet = await lancer();
      fireEvent.click(within(volet).getByRole('button', { name: /Envoyer le mail/ }));
      expect(await within(volet).findByText(/Envoi simulé/)).toBeTruthy();
      expect(api.updateTache).not.toHaveBeenCalled();

      api.envoyerMailRelanceProspection.mockRejectedValueOnce(new Error('refusé'));
      fireEvent.click(within(volet).getByRole('button', { name: /Envoyer le mail/ }));
      expect(await within(volet).findByText(/L’envoi a échoué/)).toBeTruthy();
      expect(api.updateTache).not.toHaveBeenCalled();
      expect(within(volet).getByText(/Action 1 sur/)).toBeTruthy();
    });
  });

  describe('nettoyage des tâches périmées', () => {
    const vieille = (id: string, nom: string) => ({
      ...tacheRetard,
      id,
      echeance: '2026-01-01T08:00:00Z',
      entreprise: { id: `e${id}`, nom },
    });
    beforeEach(() => {
      api.fetchPipeline.mockResolvedValue({ etapes: [], inactiviteJours: 14, opportunites: [] });
      api.fetchTaches.mockResolvedValue({
        enRetard: [vieille('v1', 'Périmée Un'), vieille('v2', 'Périmée Deux'), tacheRetard],
      });
    });

    it("propose d'écarter en une fois les seules tâches de plus de 30 jours, sans toucher aux autres", async () => {
      render(<AideRelance slug="simatis" />);
      expect(
        await screen.findByText(/2 tâche\(s\) en retard depuis plus de 30 jours/),
      ).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: /Les écarter de cette liste/ }));
      const fenetre = await screen.findByRole('dialog');
      expect(within(fenetre).getByText(/restent dans l'Agenda et dans le CRM/)).toBeTruthy();
      expect(api.masquerRelanceLot).not.toHaveBeenCalled();

      fireEvent.click(within(fenetre).getByRole('button', { name: 'Écarter 2 tâche(s)' }));
      await waitFor(() =>
        expect(api.masquerRelanceLot).toHaveBeenCalledWith(
          'simatis',
          ['ent:perimee un', 'ent:perimee deux'],
          8.64e15,
        ),
      );
      await waitFor(() => expect(screen.queryByText('Périmée Un')).toBeNull());
      expect(screen.getByText('Retard Fictif')).toBeTruthy();
      // Rien n'est clos ni supprimé : seul le rangement de la liste change.
      expect(api.updateTache).not.toHaveBeenCalled();
      expect(screen.queryByText(/depuis plus de 30 jours/)).toBeNull();
    });

    it('ne fait rien si on annule, et signale un échec sans rien cacher', async () => {
      render(<AideRelance slug="simatis" />);
      fireEvent.click(await screen.findByRole('button', { name: /Les écarter de cette liste/ }));
      fireEvent.click(
        within(await screen.findByRole('dialog')).getByRole('button', { name: 'Annuler' }),
      );
      expect(api.masquerRelanceLot).not.toHaveBeenCalled();
      expect(screen.getByText('Périmée Un')).toBeTruthy();

      api.masquerRelanceLot.mockRejectedValue(new Error('hors ligne'));
      fireEvent.click(screen.getByRole('button', { name: /Les écarter de cette liste/ }));
      fireEvent.click(
        within(await screen.findByRole('dialog')).getByRole('button', {
          name: 'Écarter 2 tâche(s)',
        }),
      );
      expect(await screen.findByRole('alert')).toBeTruthy();
      expect(screen.getByText('Périmée Un')).toBeTruthy();
    });

    it("n'écarte pas une tâche ancienne qui a une autre raison d'être proposée", async () => {
      api.fetchPipeline.mockResolvedValue({
        etapes: [
          { id: 'e1', label: 'Étape' },
          { id: 'e2', label: 'Deux' },
          { id: 'e3', label: 'Trois' },
        ],
        inactiviteJours: 14,
        opportunites: [opp(1, { entreprise: 'Périmée Un', etape: 'e3', joursInactif: 40 })],
      });
      render(<AideRelance slug="simatis" />);
      expect(
        await screen.findByText(/1 tâche\(s\) en retard depuis plus de 30 jours/),
      ).toBeTruthy();
    });
  });

  it("n'envoie ni ne crée rien tant que Marc n'a pas validé", async () => {
    render(<AideRelance slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Retard Fictif/ }));
    await screen.findByLabelText(/Mail préparé/);
    expect(api.updateTache).not.toHaveBeenCalled();
    expect(api.createTache).not.toHaveBeenCalled();
  });

  it("affiche la fiche d'appel pour une tâche d'appel", async () => {
    api.fetchTaches.mockResolvedValue({
      enRetard: [{ ...tacheRetard, id: 't2', canal: 'appel', type: 'appel' }],
    });
    render(<AideRelance slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Retard Fictif/ }));
    const volet = await screen.findByRole('dialog');
    expect(within(volet).getByText("Objectif de l'appel")).toBeTruthy();
    expect(within(volet).getByText(/Marc de SIMATIS/)).toBeTruthy();
  });

  it('indique une erreur de chargement sans planter', async () => {
    api.fetchPipeline.mockRejectedValue(new Error('hors ligne'));
    render(<AideRelance slug="simatis" />);
    expect(await screen.findByText(/Impossible de charger/)).toBeTruthy();
  });
});
