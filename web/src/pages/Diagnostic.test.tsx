// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjetDiag } from '../api.js';
import { Diagnostic, entreesRevue, modifierRevue } from './Diagnostic.js';

const api = vi.hoisted(() => ({
  fetchProjetsDiag: vi.fn(),
  fetchEntreprise: vi.fn(),
  fetchEntreprises: vi.fn(),
  fetchContact: vi.fn(),
  fetchContacts: vi.fn(),
  createContact: vi.fn(),
  createEntreprise: vi.fn(),
  creerProjetDiag: vi.fn(),
  majProjetDiag: vi.fn(),
  envoyerMessageDiag: vi.fn(),
  demandeSupportDiag: vi.fn(),
  demandeRapportDiag: vi.fn(),
  demandeRestitutionDiag: vi.fn(),
  importerEntretienDiag: vi.fn(),
  viderConversationDiag: vi.fn(),
  urlLogoDiag: (slug: string, id: string) => `/api/i/${slug}/diagnostic/projets/${id}/logo`,
  urlRapportDiag: (slug: string, id: string, version?: number) =>
    `/api/i/${slug}/diagnostic/projets/${id}/rapport${version === undefined ? '' : `?version=${version}`}`,
}));
vi.mock('../api.js', () => api);

const projet = (extra: Partial<ProjetDiag> = {}): ProjetDiag => ({
  id: 'p1',
  nom: 'Atelier Fictif Nord',
  activite: 'usinage',
  contexte: '',
  etape: 1,
  etapeMax: 1,
  dims: null,
  statutDiagnostic: null,
  dateDiagnostic: null,
  chats: {},
  profil: null,
  revue: null,
  conversation: [],
  statutChat: 'repos',
  demande: null,
  ditParDirigeant: '',
  hypotheses: '',
  aLogo: false,
  logoNom: null,
  supportStatut: 'aucun',
  supportLien: null,
  supportTexte: null,
  supportFinalLe: null,
  aRapport: false,
  rapportNom: null,
  rapportLienStatut: 'aucun',
  rapportLien: null,
  rapportLiens: [],
  rapportVersions: [],
  restitutionStatut: 'aucun',
  restitutionLien: null,
  restitutionLiens: [],
  restitutionAvecProposition: true,
  aPdfEntretien: false,
  pdfEntretienNom: null,
  reponsesEntretien: [],
  historiqueReponses: [],
  updatedAt: '2026-10-19T08:00:00.000Z',
  ...extra,
});

beforeEach(() => {
  api.fetchProjetsDiag.mockResolvedValue([projet()]);
  api.majProjetDiag.mockImplementation((_slug: string, _id: string, patch: Partial<ProjetDiag>) =>
    Promise.resolve(projet({ ...patch, id: 'p1' })),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Diagnostic', () => {
  it('liste les projets puis ouvre celui choisi', async () => {
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    expect(await screen.findByRole('heading', { name: 'Atelier Fictif Nord' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Préparer la présentation/ })).toBeTruthy();
  });

  it('crée un projet avec son nom et son activité', async () => {
    api.creerProjetDiag.mockResolvedValue(
      projet({ id: 'p2', nom: 'Bureau Fictif', activite: 'services' }),
    );
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Nouveau projet' }));
    fireEvent.change(screen.getByLabelText('Nom de l’entreprise'), {
      target: { value: 'Bureau Fictif' },
    });
    fireEvent.change(screen.getByLabelText('Activité'), { target: { value: 'services' } });
    fireEvent.click(screen.getByRole('button', { name: 'Créer et préparer' }));
    await waitFor(() =>
      expect(api.creerProjetDiag).toHaveBeenCalledWith(
        'simatis',
        'Bureau Fictif',
        'services',
        undefined,
        undefined,
      ),
    );
  });

  it('crée un projet lié à une organisation choisie et à un contact créé en fenêtre', async () => {
    api.fetchEntreprise.mockResolvedValue({ id: 'e1', nom: 'Société Fictive' });
    api.fetchEntreprises.mockImplementation((_s: string, q: string) =>
      Promise.resolve(
        q ? [{ id: 'e1', nom: 'Société Fictive' }] : [{ id: 'e1', nom: 'Société Fictive' }],
      ),
    );
    api.fetchContact.mockResolvedValue({ id: 'c1', nom: 'Dirigeant Fictif' });
    api.createContact.mockResolvedValue({ id: 'c1' });
    api.creerProjetDiag.mockResolvedValue(projet({ id: 'p3', nom: 'Société Fictive' }));
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Nouveau projet' }));

    const organisation = screen.getByLabelText('Organisation');
    fireEvent.click(within(organisation).getByRole('button', { name: 'Choisir' }));
    fireEvent.change(within(organisation).getByLabelText('Rechercher à lier'), {
      target: { value: 'Soc' },
    });
    fireEvent.click(await within(organisation).findByRole('button', { name: 'Société Fictive' }));
    // Le nom du projet reprend celui de l'organisation tant qu'il est vide.
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLInputElement>('Nom de l’entreprise').value).toBe(
        'Société Fictive',
      ),
    );

    fireEvent.click(
      within(screen.getByLabelText('Contact')).getByRole('button', { name: 'Créer un contact' }),
    );
    const fenetre = await screen.findByRole('dialog', { name: 'Nouveau contact' });
    fireEvent.change(within(fenetre).getByLabelText('Nom'), {
      target: { value: 'Dirigeant Fictif' },
    });
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Créer' }));
    expect(
      await within(screen.getByLabelText('Contact')).findByText('Dirigeant Fictif'),
    ).toBeTruthy();
    // La fenêtre de création ne valide pas le formulaire du projet.
    expect(api.creerProjetDiag).not.toHaveBeenCalled();
    expect(api.createContact.mock.calls[0]?.[1]).toMatchObject({
      nom: 'Dirigeant Fictif',
      entrepriseId: 'e1',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Créer et préparer' }));
    await waitFor(() =>
      expect(api.creerProjetDiag).toHaveBeenCalledWith(
        'simatis',
        'Société Fictive',
        expect.any(String),
        'e1',
        'c1',
      ),
    );
  });

  it('rattache un projet existant à une organisation depuis la préparation', async () => {
    api.fetchEntreprise.mockResolvedValue({ id: 'e1', nom: 'Société Fictive' });
    api.fetchEntreprises.mockResolvedValue([{ id: 'e1', nom: 'Société Fictive' }]);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    const organisation = await screen.findByLabelText('Organisation');
    fireEvent.click(within(organisation).getByRole('button', { name: 'Choisir' }));
    fireEvent.change(within(organisation).getByLabelText('Rechercher à lier'), {
      target: { value: 'Soc' },
    });
    fireEvent.click(await within(organisation).findByRole('button', { name: 'Société Fictive' }));
    await waitFor(() => expect(api.majProjetDiag).toHaveBeenCalled());
    expect(api.majProjetDiag.mock.calls[0]?.[2]).toEqual({ entrepriseId: 'e1' });
  });

  it('calcule le profil après la saisie du résultat à l étape 2', async () => {
    api.fetchProjetsDiag.mockResolvedValue([projet({ etape: 2 })]);
    api.majProjetDiag.mockResolvedValue(
      projet({
        etape: 2,
        dims: { outils: 2.5, strategie: 5.3, polyvalence: 9.5 },
        profil: 'Joggeur',
      }),
    );
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    fireEvent.change(await screen.findByLabelText('Outils et méthode (sur 10)'), {
      target: { value: '2.5' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le résultat' }));
    await waitFor(() => expect(api.majProjetDiag).toHaveBeenCalled());
    const patch = api.majProjetDiag.mock.calls[0]?.[2] as Partial<ProjetDiag>;
    expect(patch.dims?.outils).toBe(2.5);
    expect(await screen.findByText('Profil : Joggeur')).toBeTruthy();
  });

  it('refuse un lien qui ne pointe pas vers claude.ai et garde le lien valide', async () => {
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    const lien = await screen.findByLabelText(/Lien du chat claude.ai/);
    fireEvent.change(lien, { target: { value: 'https://exemple.com/chat' } });
    fireEvent.blur(lien);
    expect(await screen.findByText('Le lien doit pointer vers claude.ai.')).toBeTruthy();
    expect(api.majProjetDiag).not.toHaveBeenCalled();

    fireEvent.change(lien, { target: { value: 'https://claude.ai/chat/fictif' } });
    fireEvent.blur(lien);
    await waitFor(() => expect(api.majProjetDiag).toHaveBeenCalled());
    const patch = api.majProjetDiag.mock.calls[0]?.[2] as Partial<ProjetDiag>;
    expect(patch.chats?.['1']?.lien).toBe('https://claude.ai/chat/fictif');
  });
});

describe('Diagnostic : liste et réglages', () => {
  it('montre chaque projet à l étape la plus haute atteinte', async () => {
    api.fetchProjetsDiag.mockResolvedValue([projet({ etape: 1, etapeMax: 3 })]);
    render(<Diagnostic slug="simatis" />);
    expect(await screen.findByText(/Étape 3 · Revue des préconisations/)).toBeTruthy();
  });

  it('change le modèle d une étape neuve avec un réglage complet', async () => {
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    fireEvent.change(await screen.findByLabelText('Modèle'), { target: { value: 'opus' } });
    await waitFor(() =>
      expect(api.majProjetDiag).toHaveBeenCalledWith('simatis', 'p1', {
        chats: { '1': { modele: 'opus', effort: 'moyen', lien: '' } },
      }),
    );
  });

  it('une action refusée laisse la page en place', async () => {
    api.majProjetDiag.mockRejectedValue(new Error('Réglage refusé'));
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    fireEvent.change(await screen.findByLabelText('Effort'), { target: { value: 'max' } });
    expect(await screen.findByText('Réglage refusé')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Atelier Fictif Nord' })).toBeTruthy();
  });
});

describe('Diagnostic en cinq étapes', () => {
  it('propose les cinq étapes du processus', async () => {
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    const etapes = await screen.findByRole('list', { name: 'Étapes du diagnostic' });
    expect(etapes.querySelectorAll('li')).toHaveLength(5);
  });

  it('le rapport se télécharge à l étape 4', async () => {
    api.fetchProjetsDiag.mockResolvedValue([
      projet({ etape: 4, aRapport: true, rapportNom: 'rapport-fictif.docx' }),
    ]);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    expect(await screen.findByRole('link', { name: /rapport-fictif.docx/ })).toBeTruthy();
  });

  it('marque le diagnostic restitué à l étape 5', async () => {
    api.fetchProjetsDiag.mockResolvedValue([projet({ etape: 5 })]);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    const restituer = await screen.findByRole('button', { name: 'Marquer comme restitué' });
    expect(screen.queryByRole('button', { name: /Étape suivante/ })).toBeNull();
    fireEvent.click(restituer);
    await waitFor(() =>
      expect(api.majProjetDiag).toHaveBeenCalledWith('simatis', 'p1', {
        statutDiagnostic: 'Restitué',
      }),
    );
  });
});

describe('Formulaire de revue saisi dans l OS', () => {
  const revue = {
    statut: 'brouillon',
    preconisations: {
      r1: { choix: 'garder', detail: 'Commentaire fictif.', texte: 'Proposition fictive.' },
    },
    planAction: {
      court: { libre: '', blocs: { b3: { bloc: '3. Information', choix: 'garder', detail: '' } } },
    },
    libre: 'Remarque fictive.',
  };

  it('liste les entrées avec leur choix et leur commentaire', () => {
    const entrees = entreesRevue(revue);
    expect(entrees[0]).toMatchObject({
      titre: 'Préconisation r1',
      choix: 'garder',
      valeur: 'Commentaire fictif.',
      propose: 'Proposition fictive.',
    });
    expect(entrees.find((e) => e.titre.startsWith('Court terme · 3.'))).toMatchObject({
      choix: 'garder',
    });
  });

  it('modifie un seul champ, sans toucher au reste', () => {
    const suite = modifierRevue(
      revue,
      { chemin: ['preconisations', 'r1'], champ: 'detail' },
      'Nouveau fictif.',
    );
    expect(suite.preconisations).toEqual({
      r1: { choix: 'garder', detail: 'Nouveau fictif.', texte: 'Proposition fictive.' },
    });
    expect(revue.preconisations.r1.detail).toBe('Commentaire fictif.');
  });

  it('une revue validée repasse en brouillon à la première modification', () => {
    const suite = modifierRevue(
      { ...revue, statut: 'validée' },
      { chemin: [], champ: 'libre' },
      'Autre remarque fictive.',
    );
    expect(suite.statut).toBe('brouillon');
    expect(suite.libre).toBe('Autre remarque fictive.');
  });
});

describe('Validation de la revue à l étape 3', () => {
  it('valider la revue l enregistre comme validée', async () => {
    api.fetchProjetsDiag.mockResolvedValue([
      projet({
        etape: 3,
        etapeMax: 3,
        dims: { outils: 2.5, strategie: 5.3, polyvalence: 9.5 },
        profil: 'Joggeur',
        revue: { statut: 'brouillon', libre: 'Remarque fictive.' },
      }),
    ]);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Valider la revue' }));
    await waitFor(() => expect(api.majProjetDiag).toHaveBeenCalled());
    const patch = api.majProjetDiag.mock.calls[0]?.[2] as Partial<ProjetDiag>;
    expect(patch.revue).toMatchObject({ statut: 'validée', libre: 'Remarque fictive.' });
  });
});

describe('Assistant de l étape', () => {
  it('envoie un message et montre que Claude prépare sa réponse', async () => {
    api.fetchProjetsDiag.mockResolvedValue([projet({ etape: 3 })]);
    api.envoyerMessageDiag.mockResolvedValue(
      projet({
        etape: 3,
        statutChat: 'attente_claude',
        conversation: [
          { etape: 3, de: 'pilote', texte: 'Question fictive', at: '2026-10-19T08:00:00.000Z' },
        ],
      }),
    );
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    fireEvent.change(await screen.findByPlaceholderText('Votre message'), {
      target: { value: 'Question fictive' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer' }));
    await waitFor(() =>
      expect(api.envoyerMessageDiag).toHaveBeenCalledWith('simatis', 'p1', 'Question fictive'),
    );
    expect(await screen.findByText('Question fictive')).toBeTruthy();
    expect(screen.getByText(/En attente du runner de ce poste/)).toBeTruthy();
  });

  it('prépare le support depuis l étape 1', async () => {
    api.demandeSupportDiag.mockResolvedValue(projet({ supportStatut: 'preparation' }));
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Préparer le support' }));
    await waitFor(() =>
      expect(api.demandeSupportDiag).toHaveBeenCalledWith('simatis', 'p1', 'preparer'),
    );
    expect(await screen.findByText(/Claude prépare le support/)).toBeTruthy();
  });

  it('un deck prêt s ouvre sur claude.ai et peut être déclaré final', async () => {
    api.fetchProjetsDiag.mockResolvedValue([
      projet({ supportStatut: 'pret', supportLien: 'https://claude.ai/artifact/DeckFictif01' }),
    ]);
    api.demandeSupportDiag.mockResolvedValue(projet({ supportStatut: 'pret' }));
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    const lien = await screen.findByRole('link', { name: /Ouvrir le deck/ });
    expect(lien.getAttribute('href')).toBe('https://claude.ai/artifact/DeckFictif01');
    fireEvent.click(screen.getByRole('button', { name: 'Support final' }));
    await waitFor(() =>
      expect(api.demandeSupportDiag).toHaveBeenCalledWith('simatis', 'p1', 'final'),
    );
  });

  it('un support final montre son texte et peut être rouvert', async () => {
    api.fetchProjetsDiag.mockResolvedValue([
      projet({
        supportStatut: 'final',
        supportLien: 'https://claude.ai/artifact/DeckFictif01',
        supportFinalLe: '2026-10-20T08:00:00.000Z',
        supportTexte: [
          { titre: 'Couverture fictive', texte: 'Texte fictif', notes: 'Note fictive' },
        ],
      }),
    ]);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    expect(await screen.findByText(/Couverture fictive/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Préparer le support' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Modifier le support' }));
    await waitFor(() =>
      expect(api.demandeSupportDiag).toHaveBeenCalledWith('simatis', 'p1', 'rouvrir'),
    );
  });

  it('enregistre ce que le dirigeant a dit à la sortie du champ', async () => {
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    const champ = await screen.findByLabelText('Ce que le dirigeant vous a dit');
    fireEvent.change(champ, { target: { value: 'Ambition fictive' } });
    fireEvent.blur(champ);
    await waitFor(() =>
      expect(api.majProjetDiag).toHaveBeenCalledWith('simatis', 'p1', {
        ditParDirigeant: 'Ambition fictive',
      }),
    );
  });
});

describe('Rapport à l étape 4', () => {
  const dims = { outils: 2.5, strategie: 5.3, polyvalence: 9.5 };

  it('désactive le bouton et dit pourquoi tant que le résultat n est pas saisi', async () => {
    api.fetchProjetsDiag.mockResolvedValue([projet({ etape: 4, etapeMax: 4 })]);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    const bouton = await screen.findByRole('button', { name: 'Produire le rapport' });
    expect((bouton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Saisissez d'abord le résultat/)).toBeTruthy();
  });

  it('active le bouton dès le résultat saisi, sans revue validée, puis demande le rapport', async () => {
    api.fetchProjetsDiag.mockResolvedValue([
      projet({ etape: 4, etapeMax: 4, dims, profil: 'Joggeur', revue: null }),
    ]);
    api.demandeRapportDiag.mockResolvedValue(
      projet({ etape: 4, etapeMax: 4, dims, profil: 'Joggeur', rapportLienStatut: 'en_cours' }),
    );
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    const bouton = await screen.findByRole('button', { name: 'Produire le rapport' });
    expect((bouton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(bouton);
    await waitFor(() => expect(api.demandeRapportDiag).toHaveBeenCalledWith('simatis', 'p1'));
    expect(await screen.findByText(/Claude rédige le rapport/)).toBeTruthy();
  });

  it('prévient avant de produire une nouvelle version, et s arrête si on refuse', async () => {
    api.fetchProjetsDiag.mockResolvedValue([
      projet({
        etape: 4,
        etapeMax: 4,
        dims,
        profil: 'Joggeur',
        aRapport: true,
        rapportNom: 'rapport-fictif.docx',
        rapportLienStatut: 'pret',
      }),
    ]);
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    expect(await screen.findByText(/Donnez vos modifications dans le chat/)).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Produire la version 2' }));
    expect(confirmation).toHaveBeenCalled();
    expect(api.demandeRapportDiag).not.toHaveBeenCalled();
    confirmation.mockRestore();
  });

  it('ouvre le rapport rédigé dans un nouvel onglet', async () => {
    api.fetchProjetsDiag.mockResolvedValue([
      projet({
        etape: 4,
        etapeMax: 4,
        dims,
        profil: 'Joggeur',
        rapportLienStatut: 'pret',
        rapportLien: 'https://claude.ai/artifact/RapportFictif0004',
        rapportLiens: [
          { lien: 'https://claude.ai/artifact/RapportFictif0004', le: '2026-10-20T08:00:00.000Z' },
        ],
      }),
    ]);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    const lien = await screen.findByRole('link', { name: 'Ouvrir le rapport' });
    expect(lien.getAttribute('href')).toBe('https://claude.ai/artifact/RapportFictif0004');
    expect(lien.getAttribute('target')).toBe('_blank');
  });
});

describe('Entretien à l étape 2', () => {
  it('importe le PDF choisi, en envoyant son nom et son contenu', async () => {
    api.fetchProjetsDiag.mockResolvedValue([projet({ etape: 2, etapeMax: 2 })]);
    api.importerEntretienDiag.mockResolvedValue(
      projet({
        etape: 2,
        etapeMax: 2,
        demande: 'entretien',
        aPdfEntretien: true,
        pdfEntretienNom: 'entretien.pdf',
      }),
    );
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    const champ = await screen.findByLabelText("Importer le PDF de l'outil");
    const fichier = new File(['%PDF'], 'entretien.pdf', { type: 'application/pdf' });
    fireEvent.change(champ, { target: { files: [fichier] } });
    await waitFor(() => expect(api.importerEntretienDiag).toHaveBeenCalled());
    expect(api.importerEntretienDiag).toHaveBeenCalledWith('simatis', 'p1', {
      nom: 'entretien.pdf',
      base64: 'JVBERg==',
    });
  });

  it('montre que Claude lit le PDF pendant la demande', async () => {
    api.fetchProjetsDiag.mockResolvedValue([
      projet({ etape: 2, etapeMax: 2, demande: 'entretien', aPdfEntretien: true }),
    ]);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    expect(await screen.findByText(/Claude lit le PDF/)).toBeTruthy();
  });

  it('garde la saisie manuelle des trois notes comme secours', async () => {
    api.fetchProjetsDiag.mockResolvedValue([projet({ etape: 2, etapeMax: 2 })]);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    expect(await screen.findByRole('button', { name: 'Enregistrer le résultat' })).toBeTruthy();
  });
});

describe('Indication pendant que Claude travaille', () => {
  const question = {
    etape: 1,
    de: 'pilote' as const,
    texte: 'Question fictive',
    at: '2026-10-20T08:00:00.000Z',
  };

  it('dit que le message attend le runner de ce poste', async () => {
    api.fetchProjetsDiag.mockResolvedValue([
      projet({ conversation: [question], statutChat: 'attente_claude' }),
    ]);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    expect(await screen.findByText(/En attente du runner de ce poste/)).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'En cours…' }).disabled).toBe(
      true,
    );
  });

  it('dit que Claude répond quand le runner a pris le message', async () => {
    api.fetchProjetsDiag.mockResolvedValue([
      projet({ conversation: [question], statutChat: 'en_cours' }),
    ]);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    expect(await screen.findByText(/Claude répond à votre message/)).toBeTruthy();
  });
});

describe('Statut des étapes', () => {
  it('affiche que l étape 2 est OK quand le PDF est lu et le profil calculé', async () => {
    api.fetchProjetsDiag.mockResolvedValue([
      projet({
        etape: 2,
        etapeMax: 2,
        dims: { outils: 7.5, strategie: 5.4, polyvalence: 9.5 },
        profil: 'Sprinteur',
        pdfEntretienNom: 'outil.pdf',
        reponsesEntretien: Array.from({ length: 21 }, (_, i) => ({
          section: 'R',
          numero: i + 1,
          reponse: 'B' as const,
        })),
        aPdfEntretien: true,
      }),
    ]);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    expect(await screen.findByText(/Étape 2 : OK/)).toBeTruthy();
    expect(screen.getByText(/PDF lu \(21 réponses\), profil Sprinteur/)).toBeTruthy();
  });

  it('marque l étape réellement en cours, distincte de l étape affichée', async () => {
    api.fetchProjetsDiag.mockResolvedValue([
      projet({
        etape: 1,
        etapeMax: 3,
        supportStatut: 'final',
        dims: { outils: 7.5, strategie: 5.4, polyvalence: 9.5 },
        profil: 'Sprinteur',
        revue: { statut: 'brouillon' },
      }),
    ]);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    const enCours = await screen.findByRole('button', { name: /Revue des préconisations/ });
    expect(enCours.className).toContain('encours');
    expect(screen.getByRole('button', { name: /Préparer la présentation/ }).textContent).toContain(
      '✓',
    );
  });
});

describe('Vider la conversation de l assistant', () => {
  const question = {
    etape: 1,
    de: 'pilote' as const,
    texte: 'Question à effacer',
    at: '2026-10-20T08:00:00.000Z',
  };

  it('efface les messages de l étape après confirmation', async () => {
    api.fetchProjetsDiag.mockResolvedValue([projet({ conversation: [question] })]);
    api.viderConversationDiag.mockResolvedValue(projet({ conversation: [] }));
    const confirme = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Vider la conversation' }));
    await waitFor(() => expect(api.viderConversationDiag).toHaveBeenCalledWith('simatis', 'p1', 1));
    await waitFor(() => expect(screen.queryByText('Question à effacer')).toBeNull());
    confirme.mockRestore();
  });

  it('ne fait rien si on annule la confirmation', async () => {
    api.fetchProjetsDiag.mockResolvedValue([projet({ conversation: [question] })]);
    const confirme = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Vider la conversation' }));
    expect(api.viderConversationDiag).not.toHaveBeenCalled();
    expect(screen.getByText('Question à effacer')).toBeTruthy();
    confirme.mockRestore();
  });
});

describe('Versions du rapport et chat de l étape 4', () => {
  const dims = { outils: 2.5, strategie: 5.3, polyvalence: 9.5 };
  const avecRapport = (extra: Partial<ProjetDiag> = {}) =>
    projet({
      etape: 4,
      etapeMax: 4,
      dims,
      profil: 'Joggeur',
      aRapport: true,
      rapportNom: 'Rapport Diagnostic Endurance - Atelier Fictif Nord - v2.docx',
      rapportLienStatut: 'pret',
      rapportVersions: [
        { version: 1, le: '2026-10-20T08:00:00.000Z' },
        { version: 2, le: '2026-10-22T08:00:00.000Z' },
      ],
      ...extra,
    });

  it('le chat de l étape 4 sert à donner ses modifications', async () => {
    api.fetchProjetsDiag.mockResolvedValue([avecRapport()]);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    expect(await screen.findByText('Modifications du rapport')).toBeTruthy();
    expect(screen.getByText(/Donnez ici les modifications à intégrer au rapport/)).toBeTruthy();
  });

  it('propose la version suivante et liste les versions précédentes en téléchargement', async () => {
    api.fetchProjetsDiag.mockResolvedValue([avecRapport()]);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    expect(await screen.findByRole('button', { name: 'Produire la version 3' })).toBeTruthy();
    const ancienne = await screen.findByRole('link', { name: /Version 1, du/ });
    expect(ancienne.getAttribute('href')).toBe(
      '/api/i/simatis/diagnostic/projets/p1/rapport?version=1',
    );
  });

  it('un Word importé compte pour la version 1', async () => {
    api.fetchProjetsDiag.mockResolvedValue([
      avecRapport({ rapportVersions: [], rapportNom: 'rapport-importe.docx' }),
    ]);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    expect(await screen.findByRole('button', { name: 'Produire la version 2' })).toBeTruthy();
  });
});

describe('Deck de restitution à l étape 5', () => {
  const dims = { outils: 2.5, strategie: 5.3, polyvalence: 9.5 };

  it('refuse sans rapport et dit pourquoi', async () => {
    api.fetchProjetsDiag.mockResolvedValue([projet({ etape: 5, etapeMax: 5, dims })]);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    const bouton = await screen.findByRole('button', { name: 'Produire le deck de restitution' });
    expect((bouton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Produisez d'abord le rapport à l'étape 4/)).toBeTruthy();
    expect(screen.getByText('Proposition de collaboration')).toBeTruthy();
  });

  it('demande le deck une fois le rapport produit', async () => {
    api.fetchProjetsDiag.mockResolvedValue([
      projet({ etape: 5, etapeMax: 5, dims, aRapport: true, rapportNom: 'r.docx' }),
    ]);
    api.demandeRestitutionDiag.mockResolvedValue(
      projet({ etape: 5, dims, aRapport: true, restitutionStatut: 'en_cours' }),
    );
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Produire le deck de restitution' }));
    await waitFor(() => expect(api.demandeRestitutionDiag).toHaveBeenCalledWith('simatis', 'p1'));
    expect(await screen.findByText(/Claude crée le deck/)).toBeTruthy();
  });

  it('permet d exclure la proposition de collaboration', async () => {
    api.fetchProjetsDiag.mockResolvedValue([
      projet({ etape: 5, etapeMax: 5, dims, aRapport: true, rapportNom: 'r.docx' }),
    ]);
    api.majProjetDiag.mockResolvedValue(
      projet({ etape: 5, dims, aRapport: true, restitutionAvecProposition: false }),
    );
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    const case_ = await screen.findByRole<HTMLInputElement>('checkbox', {
      name: /Terminer par ma proposition de collaboration/,
    });
    expect(case_.checked).toBe(true);
    fireEvent.click(case_);
    await waitFor(() =>
      expect(api.majProjetDiag).toHaveBeenCalledWith('simatis', 'p1', {
        restitutionAvecProposition: false,
      }),
    );
  });

  it('ouvre le deck de restitution créé', async () => {
    api.fetchProjetsDiag.mockResolvedValue([
      projet({
        etape: 5,
        etapeMax: 5,
        dims,
        aRapport: true,
        restitutionStatut: 'pret',
        restitutionLien: 'https://claude.ai/artifact/RestitutionFictive01',
        restitutionLiens: [
          {
            lien: 'https://claude.ai/artifact/RestitutionFictive01',
            le: '2026-10-25T08:00:00.000Z',
          },
        ],
      }),
    ]);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    const lien = await screen.findByRole('link', { name: 'Ouvrir le deck de restitution' });
    expect(lien.getAttribute('href')).toBe('https://claude.ai/artifact/RestitutionFictive01');
    expect(lien.getAttribute('target')).toBe('_blank');
  });
});
