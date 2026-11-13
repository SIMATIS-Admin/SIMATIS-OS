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
  fetchFiche: vi.fn(),
  fetchOpportunitesRecherche: vi.fn(),
  createContact: vi.fn(),
  createEntreprise: vi.fn(),
  creerProjetDiag: vi.fn(),
  majProjetDiag: vi.fn(),
  envoyerMessageDiag: vi.fn(),
  demandeSupportDiag: vi.fn(),
  cadrerRapportDiag: vi.fn(),
  demandeRapportDiag: vi.fn(),
  demandeRestitutionDiag: vi.fn(),
  exporterRestitutionDiag: vi.fn(),
  importerDeckRestitutionDiag: vi.fn(),
  purgerPresentationRestitutionDiag: vi.fn(),
  rendezVousCapitalisationDiag: vi.fn(),
  proposerCapitalisationDiag: vi.fn(),
  enregistrerCapitalisationDiag: vi.fn(),
  urlPptxRestitutionDiag: (slug: string, id: string) =>
    `/api/i/${slug}/diagnostic/projets/${id}/restitution/pptx`,
  importerEntretienDiag: vi.fn(),
  importerRapportDiag: vi.fn(),
  envoyerRapportDriveDiag: vi.fn(),
  marquerRapportFinal: vi.fn(),
  reglagesDiagnostic: vi.fn(),
  journalReglesDiag: vi.fn(),
  capitaliserSupportDiag: vi.fn(),
  capitaliserDeckDiag: vi.fn(),
  marquerDeckFinalDiag: vi.fn(),
  capitaliserAnalyseDiag: vi.fn(),
  preparerRevueDiag: vi.fn(),
  exporterRevueDiag: vi.fn(),
  preparerDossierRapportDiag: vi.fn(),
  capitaliserRapportDiag: vi.fn(),
  annulerRegleDiag: vi.fn(),
  majReglagesDiagnostic: vi.fn(),
  viderConversationDiag: vi.fn(),
  urlLogoDiag: (slug: string, id: string) => `/api/i/${slug}/diagnostic/projets/${id}/logo`,
  urlExportRapportDiag: (slug: string, id: string) =>
    `/api/i/${slug}/diagnostic/projets/${id}/rapport/export`,
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
  revueExportStatut: 'aucun',
  revueExportLien: null,
  dossierExportStatut: 'aucun',
  dossierExportLien: null,
  restitutionStatut: 'aucun',
  restitutionLien: null,
  restitutionLiens: [],
  restitutionAvecProposition: true,
  aPptx: false,
  restitutionExportLe: null,
  capitalisationStatut: 'aucun',
  capitalisationRdvId: null,
  capitalisationCompteRenduAt: null,
  opportuniteId: null,
  proposition: null,
  aPdfEntretien: false,
  pdfEntretienNom: null,
  reponsesEntretien: [],
  historiqueReponses: [],
  updatedAt: '2026-10-19T08:00:00.000Z',
  ...extra,
});

beforeEach(() => {
  api.fetchProjetsDiag.mockResolvedValue([projet()]);
  api.rendezVousCapitalisationDiag.mockResolvedValue([]);
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

  it('étape 2 : plus de saisie à la main, enregistrer marque l entretien fait', async () => {
    const dims = { outils: 2.5, strategie: 5.3, polyvalence: 9.5 };
    api.fetchProjetsDiag.mockResolvedValue([projet({ etape: 2, dims, profil: 'Joggeur' })]);
    api.majProjetDiag.mockResolvedValue(
      projet({ etape: 2, dims, profil: 'Joggeur', statutDiagnostic: 'Rapport à rédiger' }),
    );
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    expect(screen.queryByLabelText('Outils et méthode (sur 10)')).toBeNull();
    expect(screen.queryByLabelText('Statut')).toBeNull();
    expect(await screen.findByText('2.5 / 10')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Date de l’entretien'), {
      target: { value: '2026-10-06' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le résultat' }));
    await waitFor(() =>
      expect(api.majProjetDiag).toHaveBeenCalledWith('simatis', 'p1', {
        statutDiagnostic: 'Rapport à rédiger',
        dateDiagnostic: '2026-10-06',
      }),
    );
    expect(await screen.findByText(/revue des préconisations/)).toBeTruthy();
  });

  it('étape 2 : enregistrer reste impossible tant que le PDF n a pas donné de notes', async () => {
    api.fetchProjetsDiag.mockResolvedValue([projet({ etape: 2 })]);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    const bouton = await screen.findByRole('button', { name: 'Enregistrer le résultat' });
    expect((bouton as HTMLButtonElement).disabled).toBe(true);
  });

  it('étape 2 : un statut Restitué n est pas écrasé', async () => {
    const dims = { outils: 2.5, strategie: 5.3, polyvalence: 9.5 };
    api.fetchProjetsDiag.mockResolvedValue([
      projet({ etape: 2, dims, profil: 'Joggeur', statutDiagnostic: 'Restitué' }),
    ]);
    api.majProjetDiag.mockResolvedValue(projet({ etape: 2, dims }));
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer le résultat' }));
    await waitFor(() =>
      expect(api.majProjetDiag).toHaveBeenCalledWith('simatis', 'p1', {
        statutDiagnostic: 'Restitué',
        dateDiagnostic: null,
      }),
    );
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

  it('un support dont le texte est gardé se présente dans l’OS', async () => {
    api.fetchProjetsDiag.mockResolvedValue([
      projet({
        supportStatut: 'final',
        supportTexte: [{ titre: 'Introduction', texte: 'Le modèle', notes: '' }],
      }),
    ]);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    const lien = await screen.findByRole('link', { name: 'Présenter dans l’OS' });
    expect(lien.getAttribute('href')).toBe('#/simatis/diaporama/support/p1');
  });

  it('un support final n affiche plus le texte des diapositives et peut être rouvert', async () => {
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
    expect(await screen.findByText(/Archivé le/)).toBeTruthy();
    expect(screen.queryByText(/Couverture fictive/)).toBeNull();
    expect(screen.queryByText('Notes d’orateur')).toBeNull();
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

  it('met le dossier pour Claude Chat et le dépôt du Word en avant, la rédaction de l OS repliée', async () => {
    api.fetchProjetsDiag.mockResolvedValue([
      projet({ etape: 4, etapeMax: 4, dims, profil: 'Joggeur' }),
    ]);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    const dossier = await screen.findByRole('button', {
      name: 'Préparer le dossier pour Claude Chat',
    });
    expect(dossier.closest('details')).toBeNull();
    expect(screen.getByLabelText('Importer ma version du rapport').closest('details')).toBeNull();
    for (const nom of ['Produire le rapport', 'Cadrer le rapport avec Claude']) {
      expect(screen.getByRole('button', { name: nom }).closest('details.diag-plus')).not.toBeNull();
    }
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

  it('propose de cadrer le rapport avec Claude : désactivé sans résultat ou pendant qu il répond', async () => {
    const bouton = { name: 'Cadrer le rapport avec Claude' };
    api.fetchProjetsDiag.mockResolvedValue([projet({ etape: 4, etapeMax: 4 })]);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    expect((await screen.findByRole<HTMLButtonElement>('button', bouton)).disabled).toBe(true);
    cleanup();
    api.fetchProjetsDiag.mockResolvedValue([
      projet({ etape: 4, etapeMax: 4, dims, profil: 'Joggeur', statutChat: 'attente_claude' }),
    ]);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    expect((await screen.findByRole<HTMLButtonElement>('button', bouton)).disabled).toBe(true);
  });

  it('lance le cadrage, et affiche le message de l API en cas de refus', async () => {
    const bouton = { name: 'Cadrer le rapport avec Claude' };
    api.fetchProjetsDiag.mockResolvedValue([
      projet({ etape: 4, etapeMax: 4, dims, profil: 'Joggeur' }),
    ]);
    api.cadrerRapportDiag.mockResolvedValue(
      projet({ etape: 4, etapeMax: 4, dims, profil: 'Joggeur', statutChat: 'attente_claude' }),
    );
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    fireEvent.click(await screen.findByRole('button', bouton));
    await waitFor(() => expect(api.cadrerRapportDiag).toHaveBeenCalledWith('simatis', 'p1'));
    cleanup();
    api.cadrerRapportDiag.mockRejectedValue(
      new Error('Un rapport est déjà en cours de rédaction.'),
    );
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    fireEvent.click(await screen.findByRole('button', bouton));
    expect(await screen.findByText(/déjà en cours de rédaction/)).toBeTruthy();
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
    expect(
      await screen.findByText(/Le parcours : préparez le dossier pour Claude Chat/),
    ).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Produire la version 2' }));
    expect(confirmation).toHaveBeenCalled();
    expect(api.demandeRapportDiag).not.toHaveBeenCalled();
    confirmation.mockRestore();
  });

  it('annonce la version suivante d après le numéro du Word (v3 → version 4)', async () => {
    api.fetchProjetsDiag.mockResolvedValue([
      projet({
        etape: 4,
        etapeMax: 4,
        dims,
        profil: 'Joggeur',
        aRapport: true,
        rapportNom: 'Rapport Diagnostic Endurance - Atelier Fictif Nord - v3.docx',
        rapportLienStatut: 'pret',
      }),
    ]);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    expect(await screen.findByRole('button', { name: 'Produire la version 4' })).toBeTruthy();
  });

  it('importe la version retravaillée en externe, après confirmation', async () => {
    const p = projet({
      etape: 4,
      etapeMax: 4,
      dims,
      profil: 'Joggeur',
      aRapport: true,
      rapportNom: 'rapport - v3.docx',
      rapportLienStatut: 'pret',
    });
    api.fetchProjetsDiag.mockResolvedValue([p]);
    api.importerRapportDiag.mockResolvedValue({ ...p, rapportNom: 'rapport - v4.docx' });
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    const champ = await screen.findByLabelText('Importer ma version du rapport');
    const fichier = new File(['PK'], 'rapport - v4.docx');
    fireEvent.change(champ, { target: { files: [fichier] } });
    await waitFor(() => expect(api.importerRapportDiag).toHaveBeenCalled());
    expect(api.importerRapportDiag.mock.calls[0]?.slice(0, 2)).toEqual(['simatis', 'p1']);
    expect((api.importerRapportDiag.mock.calls[0]?.[2] as { nom: string }).nom).toBe(
      'rapport - v4.docx',
    );
    expect(confirmation).toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Produire la version 5' })).toBeTruthy();
    confirmation.mockRestore();
  });

  it('place la conversation dans une fenêtre flottante, réductible, fermable et rouvrable', async () => {
    api.fetchProjetsDiag.mockResolvedValue([projet({ etape: 4, etapeMax: 4, dims })]);
    const { container } = render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    await screen.findByText('Rapport remis au dirigeant');
    expect(container.querySelector('.diag-main .diag-chat')).toBeNull();
    const fenetre = container.querySelector('.diag-flottant')!;
    expect(fenetre.querySelectorAll('.diag-chat')).toHaveLength(1);
    expect(fenetre.classList.contains('reduit')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Agrandir la fenêtre Claude' }));
    expect(fenetre.classList.contains('ouvert')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Fermer la fenêtre Claude' }));
    expect(fenetre.classList.contains('ferme')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir Claude' }));
    expect(fenetre.classList.contains('ouvert')).toBe(true);
  });

  it('une seule liste de versions : Google Doc et Word sur la même ligne', async () => {
    api.fetchProjetsDiag.mockResolvedValue([
      projet({
        etape: 4,
        etapeMax: 4,
        dims,
        aRapport: true,
        rapportNom: 'Rapport - v2.docx',
        rapportLiens: [
          {
            lien: 'https://docs.google.com/document/d/b/edit',
            le: '2026-11-06T08:00:00.000Z',
            version: 2,
          },
          {
            lien: 'https://docs.google.com/document/d/a/edit',
            le: '2026-11-05T08:00:00.000Z',
            version: 1,
          },
        ],
        rapportVersions: [
          { version: 1, le: '2026-11-05T08:00:00.000Z' },
          { version: 2, le: '2026-11-06T08:00:00.000Z' },
        ],
      }),
    ]);
    const { container } = render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    await screen.findByText('Versions du rapport');
    expect(screen.queryByText(/Versions précédentes/)).toBeNull();
    expect(screen.queryByText(/Rapports précédents/)).toBeNull();
    expect(container.querySelectorAll('.diag-main li')).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: 'Word' })).toHaveLength(2);
  });
});

describe('Mise en page des étapes', () => {
  const dims = { outils: 2.5, strategie: 5.3, polyvalence: 9.5 };

  it.each([
    [1, 'moitie'],
    [2, 'moitie'],
    [3, ''],
    [5, 'moitie'],
  ])('étape %i : classe « %s »', async (etape, classe) => {
    api.fetchProjetsDiag.mockResolvedValue([projet({ etape, etapeMax: etape })]);
    const { container } = render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    await screen.findByLabelText(/Assistant Claude/);
    const mise = container.querySelector('.diag-layout')!;
    expect(mise.classList.contains('moitie')).toBe(classe === 'moitie');
    expect(mise.classList.contains('empile')).toBe(false);
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
    expect(screen.queryByRole('link', { name: 'Exporter en .docx' })).toBeNull();
  });

  it('ouvre le Google Doc du rapport et exporte le Word depuis Drive', async () => {
    api.fetchProjetsDiag.mockResolvedValue([
      projet({
        etape: 4,
        etapeMax: 4,
        dims,
        profil: 'Joggeur',
        aRapport: true,
        rapportNom: 'Rapport - v2.docx',
        rapportLienStatut: 'pret',
        rapportLien: 'https://docs.google.com/document/d/doc-2/edit',
        rapportLiens: [
          {
            lien: 'https://docs.google.com/document/d/doc-2/edit',
            le: '2026-10-28T08:00:00.000Z',
            version: 2,
          },
          {
            lien: 'https://docs.google.com/document/d/doc-1/edit',
            le: '2026-10-27T08:00:00.000Z',
            version: 1,
          },
        ],
      }),
    ]);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    const doc = await screen.findByRole('link', { name: 'Ouvrir dans Google Docs' });
    expect(doc.getAttribute('href')).toBe('https://docs.google.com/document/d/doc-2/edit');
    const exporter = screen.getByRole('link', { name: 'Exporter en .docx' });
    expect(exporter.getAttribute('href')).toContain('/diagnostic/projets/p1/rapport/export');
  });
});

describe('Rapport : envoi sur Drive', () => {
  const dims = { outils: 2.5, strategie: 5.3, polyvalence: 9.5 };

  it('lit la version dans un nom de fichier du navigateur (« _v3 (1).docx »)', async () => {
    api.fetchProjetsDiag.mockResolvedValue([
      projet({
        etape: 4,
        etapeMax: 4,
        dims,
        profil: 'Joggeur',
        aRapport: true,
        rapportNom: 'Rapport_Atelier_-_v3 (1).docx',
        rapportLienStatut: 'pret',
      }),
    ]);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    expect(await screen.findByRole('button', { name: 'Produire la version 4' })).toBeTruthy();
  });

  it('propose d envoyer le Word affiché sur Drive, puis montre le Google Doc', async () => {
    const p = projet({
      etape: 4,
      etapeMax: 4,
      dims,
      profil: 'Joggeur',
      aRapport: true,
      rapportNom: 'rapport - v3.docx',
      rapportLienStatut: 'pret',
    });
    api.fetchProjetsDiag.mockResolvedValue([p]);
    api.envoyerRapportDriveDiag.mockResolvedValue({
      ...p,
      rapportLien: 'https://docs.google.com/document/d/doc-3/edit',
    });
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Envoyer sur Drive' }));
    await waitFor(() => expect(api.envoyerRapportDriveDiag).toHaveBeenCalledWith('simatis', 'p1'));
    expect(await screen.findByRole('link', { name: 'Ouvrir dans Google Docs' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Envoyer sur Drive' })).toBeNull();
  });

  it('n offre pas l envoi quand le rapport est déjà un Google Doc', async () => {
    api.fetchProjetsDiag.mockResolvedValue([
      projet({
        etape: 4,
        etapeMax: 4,
        dims,
        profil: 'Joggeur',
        aRapport: true,
        rapportNom: 'rapport - v3.docx',
        rapportLienStatut: 'pret',
        rapportLien: 'https://docs.google.com/document/d/doc-3/edit',
      }),
    ]);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    await screen.findByRole('link', { name: 'Ouvrir dans Google Docs' });
    expect(screen.queryByRole('button', { name: 'Envoyer sur Drive' })).toBeNull();
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

  // La dictée (Wispr Flow) doit pouvoir remplir le champ pendant l'attente ; seul l'envoi est bloqué.
  it('laisse écrire le prochain message pendant que Claude répond', async () => {
    api.fetchProjetsDiag.mockResolvedValue([
      projet({ conversation: [question], statutChat: 'en_cours' }),
    ]);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    const champ = await screen.findByPlaceholderText<HTMLTextAreaElement>('Votre message');
    expect(champ.disabled).toBe(false);
    fireEvent.change(champ, { target: { value: 'Message dicté pendant l’attente' } });
    expect(champ.value).toBe('Message dicté pendant l’attente');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'En cours…' }).disabled).toBe(
      true,
    );
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
    const ligne = (await screen.findByText(/Version 1 du/)).closest('li')!;
    const ancienne = within(ligne as HTMLElement).getByRole('link', { name: 'Word' });
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

  it('enregistre la formule d abonnement et une option sans montant', async () => {
    api.fetchProjetsDiag.mockResolvedValue([
      projet({ etape: 5, etapeMax: 5, dims, aRapport: true, rapportNom: 'r.docx' }),
    ]);
    api.majProjetDiag.mockResolvedValue(projet({ etape: 5, dims, aRapport: true }));
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    fireEvent.change(await screen.findByLabelText('Formule d’abonnement'), {
      target: { value: 'Accompagnement fictif' },
    });
    fireEvent.change(screen.getByLabelText('Mensualité (€)'), { target: { value: '1500' } });
    fireEvent.change(screen.getByLabelText('Prestations incluses (une par ligne)'), {
      target: { value: 'Point hebdomadaire\nTableau de bord' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une option' }));
    fireEvent.change(screen.getByLabelText('Libellé de l’option 1'), {
      target: { value: 'Outil sur mesure fictif' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer la proposition' }));
    await waitFor(() =>
      expect(api.majProjetDiag).toHaveBeenCalledWith('simatis', 'p1', {
        proposition: {
          formule: {
            libelle: 'Accompagnement fictif',
            mensualite: 1500,
            engagementMois: 12,
            tacite: true,
            prestations: ['Point hebdomadaire', 'Tableau de bord'],
          },
          options: [
            {
              id: expect.any(String) as string,
              libelle: 'Outil sur mesure fictif',
              description: '',
              tarif: { mode: 'forfait', montant: null },
            },
          ],
        },
      }),
    );
  });

  describe('export PowerPoint', () => {
    const deckPret = (extra: Partial<ProjetDiag> = {}) =>
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
            le: '2026-10-28T09:00:00.000Z',
          },
        ],
        ...extra,
      });
    const ouvrir = async () => {
      render(<Diagnostic slug="simatis" />);
      fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    };

    it('exporte le deck en PowerPoint quand il convient, puis indique que l export est en cours', async () => {
      api.fetchProjetsDiag.mockResolvedValue([deckPret()]);
      api.exporterRestitutionDiag.mockResolvedValue(
        deckPret({ demande: 'restitution_export', statutChat: 'attente_claude' }),
      );
      await ouvrir();
      fireEvent.click(await screen.findByRole('button', { name: 'Exporter en PowerPoint' }));
      await waitFor(() =>
        expect(api.exporterRestitutionDiag).toHaveBeenCalledWith('simatis', 'p1'),
      );
      expect(await screen.findByText(/Export PowerPoint en cours/)).toBeTruthy();
      const bouton = screen.getByRole<HTMLButtonElement>('button', {
        name: 'Exporter en PowerPoint',
      });
      expect(bouton.disabled).toBe(true);
    });

    it('importe un deck déjà construit à partir de son lien', async () => {
      api.fetchProjetsDiag.mockResolvedValue([deckPret()]);
      api.importerDeckRestitutionDiag.mockResolvedValue(
        deckPret({ demande: 'restitution_export', statutChat: 'attente_claude' }),
      );
      await ouvrir();
      const bouton = await screen.findByRole<HTMLButtonElement>('button', {
        name: 'Préparer la présentation dans l’OS',
      });
      expect(bouton.disabled).toBe(true);
      fireEvent.change(screen.getByLabelText(/Lien du deck/), {
        target: { value: 'https://claude.ai/artifact/DeckFictif01#slide-ab12' },
      });
      fireEvent.click(bouton);
      await waitFor(() =>
        expect(api.importerDeckRestitutionDiag).toHaveBeenCalledWith(
          'simatis',
          'p1',
          'https://claude.ai/artifact/DeckFictif01#slide-ab12',
        ),
      );
    });

    it('supprime la présentation de l’OS quand le deck a été exporté', async () => {
      api.fetchProjetsDiag.mockResolvedValue([
        deckPret({ aPptx: true, restitutionExportLe: '2026-10-28T10:30:00.000Z' }),
      ]);
      api.purgerPresentationRestitutionDiag.mockResolvedValue(deckPret());
      await ouvrir();
      fireEvent.click(
        await screen.findByRole('button', { name: 'Supprimer la présentation de l’OS' }),
      );
      await waitFor(() =>
        expect(api.purgerPresentationRestitutionDiag).toHaveBeenCalledWith('simatis', 'p1'),
      );
      await waitFor(() =>
        expect(
          screen.queryByRole('button', { name: 'Supprimer la présentation de l’OS' }),
        ).toBeNull(),
      );
    });

    it('n exporte pas tant qu aucun deck n existe', async () => {
      api.fetchProjetsDiag.mockResolvedValue([
        projet({ etape: 5, etapeMax: 5, dims, aRapport: true }),
      ]);
      await ouvrir();
      await screen.findByRole('button', { name: 'Produire le deck de restitution' });
      expect(screen.queryByRole('button', { name: 'Exporter en PowerPoint' })).toBeNull();
    });

    it('propose le téléchargement du PowerPoint exporté, avec sa date', async () => {
      api.fetchProjetsDiag.mockResolvedValue([
        deckPret({ aPptx: true, restitutionExportLe: '2026-10-28T10:30:00.000Z' }),
      ]);
      await ouvrir();
      const lien = await screen.findByRole<HTMLAnchorElement>('link', {
        name: /Télécharger le PowerPoint/,
      });
      expect(lien.getAttribute('href')).toBe(
        '/api/i/simatis/diagnostic/projets/p1/restitution/pptx',
      );
      expect(screen.getByText(/exporté le 28\/10\/2026/)).toBeTruthy();
    });

    it('propose de présenter dans l’OS le deck exporté', async () => {
      api.fetchProjetsDiag.mockResolvedValue([
        deckPret({ aPptx: true, restitutionExportLe: '2026-10-28T10:30:00.000Z' }),
      ]);
      await ouvrir();
      const lien = await screen.findByRole('link', { name: 'Présenter dans l’OS' });
      expect(lien.getAttribute('href')).toBe('#/simatis/diaporama/restitution/p1');
    });

    it('sans export, rien à présenter dans l’OS', async () => {
      api.fetchProjetsDiag.mockResolvedValue([deckPret()]);
      await ouvrir();
      await screen.findByRole('button', { name: 'Exporter en PowerPoint' });
      expect(screen.queryByRole('link', { name: 'Présenter dans l’OS' })).toBeNull();
    });

    it('sans export, aucun lien de téléchargement', async () => {
      api.fetchProjetsDiag.mockResolvedValue([deckPret()]);
      await ouvrir();
      await screen.findByRole('button', { name: 'Exporter en PowerPoint' });
      expect(screen.queryByRole('link', { name: /Télécharger le PowerPoint/ })).toBeNull();
    });
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

describe('Capitalisation de la restitution à l étape 5', () => {
  const dims = { outils: 2.5, strategie: 5.3, polyvalence: 9.5 };
  const rdvs = [
    {
      id: 'r-recent',
      titre: 'Restitution fictive',
      debut: '2026-10-29T14:00:00Z',
      compteRenduAt: '2026-10-29T16:00:00Z',
    },
    {
      id: 'r-ancien',
      titre: 'Point fictif',
      debut: '2026-10-01T09:00:00Z',
      compteRenduAt: '2026-10-01T10:00:00Z',
    },
  ];
  const ouvrir = async (extra: Partial<ProjetDiag> = {}) => {
    api.fetchProjetsDiag.mockResolvedValue([
      projet({ etape: 5, etapeMax: 5, dims, aRapport: true, rapportNom: 'r.docx', ...extra }),
    ]);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
  };

  it('dit qu aucun compte rendu n est trouvé et désactive le bouton', async () => {
    await ouvrir();
    expect(await screen.findByText(/Aucun compte rendu trouvé pour cette entreprise/)).toBeTruthy();
    const bouton = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Capitaliser la restitution',
    });
    expect(bouton.disabled).toBe(true);
  });

  it('présélectionne le rendez-vous le plus récent et envoie son identifiant', async () => {
    api.rendezVousCapitalisationDiag.mockResolvedValue(rdvs);
    api.proposerCapitalisationDiag.mockResolvedValue(
      projet({ etape: 5, dims, capitalisationStatut: 'en_cours' }),
    );
    await ouvrir();
    const bouton = await screen.findByRole<HTMLButtonElement>('button', {
      name: 'Capitaliser la restitution',
    });
    await waitFor(() => expect(bouton.disabled).toBe(false));
    fireEvent.click(bouton);
    await waitFor(() =>
      expect(api.proposerCapitalisationDiag).toHaveBeenCalledWith('simatis', 'p1', 'r-recent'),
    );
    expect(await screen.findByText(/Analyse du compte rendu en cours/)).toBeTruthy();
  });

  it('ne propose d enregistrer qu une fois la proposition faite', async () => {
    api.rendezVousCapitalisationDiag.mockResolvedValue(rdvs);
    await ouvrir();
    await screen.findByRole('button', { name: 'Capitaliser la restitution' });
    expect(screen.queryByRole('button', { name: 'Enregistrer dans le second cerveau' })).toBeNull();
    cleanup();
    api.enregistrerCapitalisationDiag.mockResolvedValue(
      projet({
        etape: 5,
        dims,
        capitalisationStatut: 'propose',
        demande: 'capitalisation_enregistrer',
      }),
    );
    await ouvrir({ capitalisationStatut: 'propose' });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Enregistrer dans le second cerveau' }),
    );
    await waitFor(() =>
      expect(api.enregistrerCapitalisationDiag).toHaveBeenCalledWith('simatis', 'p1'),
    );
  });

  it('affiche l état enregistré', async () => {
    api.rendezVousCapitalisationDiag.mockResolvedValue(rdvs);
    await ouvrir({ capitalisationStatut: 'enregistre' });
    expect(
      await screen.findByText(/Capitalisation enregistrée dans le second cerveau/),
    ).toBeTruthy();
  });
});

describe('Affaire du projet de diagnostic', () => {
  it('permet de relier le projet à une affaire, puis de la retirer', async () => {
    api.fetchOpportunitesRecherche.mockResolvedValue([{ id: 'o1', titre: 'Affaire Fictive' }]);
    api.fetchFiche.mockResolvedValue({ fiche: { id: 'o1', titre: 'Affaire Fictive' } });
    api.fetchProjetsDiag.mockResolvedValue([projet()]);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));

    const affaire = await screen.findByLabelText('Affaire');
    expect(within(affaire).queryByRole('button', { name: /Créer/ })).toBeNull();
    fireEvent.click(within(affaire).getByRole('button', { name: 'Choisir' }));
    fireEvent.change(within(affaire).getByLabelText('Rechercher à lier'), {
      target: { value: 'Aff' },
    });
    fireEvent.click(await within(affaire).findByRole('button', { name: 'Affaire Fictive' }));
    await waitFor(() =>
      expect(api.majProjetDiag).toHaveBeenCalledWith('simatis', 'p1', { opportuniteId: 'o1' }),
    );
  });
});

describe('Rapport : version finale', () => {
  const dims = { outils: 2.5, strategie: 5.3, polyvalence: 9.5 };
  const doc = (n: number) => `https://docs.google.com/document/d/doc-${n}/edit`;
  const enEtape4 = (extra: Partial<ProjetDiag> = {}) =>
    projet({
      etape: 4,
      etapeMax: 4,
      dims,
      profil: 'Joggeur',
      aRapport: true,
      rapportNom: 'Rapport - v4.docx',
      rapportLienStatut: 'pret',
      rapportLien: doc(4),
      rapportLiens: [
        { lien: doc(4), le: '2026-10-29T08:00:00.000Z', version: 4 },
        { lien: doc(3), le: '2026-10-28T08:00:00.000Z', version: 3 },
        { lien: 'https://claude.ai/artifact/AncienFictif', le: '2026-10-22T08:00:00.000Z' },
      ],
      ...extra,
    });
  const ouvrir = async (p: ProjetDiag) => {
    api.fetchProjetsDiag.mockResolvedValue([p]);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
  };

  it('une case par Google Doc, aucune pour un artifact', async () => {
    await ouvrir(enEtape4());
    expect(await screen.findAllByRole('checkbox', { name: /Version finale/ })).toHaveLength(2);
  });

  it('cocher appelle l API et met en évidence la version finale', async () => {
    const p = enEtape4();
    api.marquerRapportFinal.mockResolvedValue({
      ...p,
      rapportLiens: p.rapportLiens.map((l) => (l.lien === doc(4) ? { ...l, finale: true } : l)),
    });
    await ouvrir(p);
    const cases = await screen.findAllByRole('checkbox', { name: /Version finale/ });
    fireEvent.click(cases[0]!);
    await waitFor(() =>
      expect(api.marquerRapportFinal).toHaveBeenCalledWith('simatis', 'p1', doc(4), true),
    );
    await waitFor(() =>
      expect(
        (screen.getAllByRole('checkbox', { name: /Version finale/ })[0] as HTMLInputElement)
          .checked,
      ).toBe(true),
    );
  });

  it('décocher la version finale', async () => {
    const p = enEtape4({
      rapportLiens: [{ lien: doc(4), le: '2026-10-29T08:00:00.000Z', version: 4, finale: true }],
    });
    api.marquerRapportFinal.mockResolvedValue({
      ...p,
      rapportLiens: [{ lien: doc(4), le: '2026-10-29T08:00:00.000Z', version: 4 }],
    });
    await ouvrir(p);
    fireEvent.click(await screen.findByRole('checkbox', { name: /Version finale/ }));
    await waitFor(() =>
      expect(api.marquerRapportFinal).toHaveBeenCalledWith('simatis', 'p1', doc(4), false),
    );
  });

  it('cases désactivées pendant la production', async () => {
    await ouvrir(enEtape4({ rapportLienStatut: 'en_cours' }));
    const cases = await screen.findAllByRole('checkbox', { name: /Version finale/ });
    expect(cases.every((c) => (c as HTMLInputElement).disabled)).toBe(true);
  });

  it('affiche le message de l API quand le choix est refusé', async () => {
    api.marquerRapportFinal.mockRejectedValue(
      new Error('Cette version n’appartient pas à ce projet.'),
    );
    await ouvrir(enEtape4());
    fireEvent.click((await screen.findAllByRole('checkbox', { name: /Version finale/ }))[0]!);
    expect(await screen.findByText(/n’appartient pas à ce projet/)).toBeTruthy();
  });
});

describe('Rapport : réglage Relire les finaux', () => {
  const dims = { outils: 2.5, strategie: 5.3, polyvalence: 9.5 };
  const ouvrir = async () => {
    api.fetchProjetsDiag.mockResolvedValue([
      projet({ etape: 4, etapeMax: 4, dims, profil: 'Joggeur' }),
    ]);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
  };
  const libelle = /Relire les deux derniers rapports finaux/;

  it('la case est cochée par défaut', async () => {
    api.reglagesDiagnostic.mockResolvedValue({ relireFinaux: true, relireSupports: true });
    await ouvrir();
    const c = await screen.findByRole<HTMLInputElement>('checkbox', { name: libelle });
    await waitFor(() => expect(c.checked).toBe(true));
  });

  it('décocher enregistre le réglage', async () => {
    api.reglagesDiagnostic.mockResolvedValue({ relireFinaux: true, relireSupports: true });
    api.majReglagesDiagnostic.mockResolvedValue({ relireFinaux: false, relireSupports: true });
    await ouvrir();
    fireEvent.click(await screen.findByRole('checkbox', { name: libelle }));
    await waitFor(() =>
      expect(api.majReglagesDiagnostic).toHaveBeenCalledWith('simatis', { relireFinaux: false }),
    );
    await waitFor(() =>
      expect(screen.getByRole<HTMLInputElement>('checkbox', { name: libelle }).checked).toBe(false),
    );
  });

  it('un réglage décoché au chargement s affiche décoché', async () => {
    api.reglagesDiagnostic.mockResolvedValue({ relireFinaux: false, relireSupports: true });
    await ouvrir();
    const c = await screen.findByRole<HTMLInputElement>('checkbox', { name: libelle });
    await waitFor(() => expect(c.checked).toBe(false));
  });
});

describe('Rapport : règles apprises', () => {
  const dims = { outils: 2.5, strategie: 5.3, polyvalence: 9.5 };
  const doc = 'https://docs.google.com/document/d/doc-4/edit';
  const entree = (extra: Record<string, unknown> = {}) => ({
    id: 'e1',
    le: '2026-11-05T10:00:00.000Z',
    projetId: 'p1',
    fiche: 'rapport',
    action: 'ajoutée',
    libelle: 'Aucune proposition dans le rapport',
    avant: null,
    apres: 'Règle fictive',
    origine: 'version finale 4',
    statut: 'actif',
    motifRefus: null,
    ...extra,
  });
  const ouvrir = async (extra: Partial<ProjetDiag> = {}) => {
    api.fetchProjetsDiag.mockResolvedValue([
      projet({
        etape: 4,
        etapeMax: 4,
        dims,
        profil: 'Joggeur',
        aRapport: true,
        rapportNom: 'Rapport - v4.docx',
        rapportLienStatut: 'pret',
        rapportLien: doc,
        rapportLiens: [{ lien: doc, le: '2026-10-29T08:00:00.000Z', version: 4, finale: true }],
        ...extra,
      }),
    ]);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
  };

  it('liste les règles apprises avec leur libellé', async () => {
    api.journalReglesDiag.mockResolvedValue([entree()]);
    await ouvrir();
    expect(await screen.findByText('Aucune proposition dans le rapport')).toBeTruthy();
    expect(screen.getByText(/Règles apprises \(1\)/)).toBeTruthy();
  });

  it('annuler appelle l API, seulement sur une règle active et annulable', async () => {
    api.journalReglesDiag.mockResolvedValue([
      entree(),
      entree({ id: 'e2', libelle: 'Déjà annulée', statut: 'annule' }),
      entree({ id: 'e3', libelle: 'Contradiction fictive', action: 'signalée' }),
    ]);
    api.annulerRegleDiag.mockResolvedValue(projet({ etape: 4, etapeMax: 4, dims }));
    await ouvrir();
    await screen.findByText('Aucune proposition dans le rapport');
    const boutons = screen.getAllByRole('button', { name: /^Annuler la règle/ });
    expect(boutons).toHaveLength(1);
    fireEvent.click(boutons[0]!);
    await waitFor(() => expect(api.annulerRegleDiag).toHaveBeenCalledWith('simatis', 'p1', 'e1'));
  });

  it('affiche le motif quand une annulation n a pas pu se faire', async () => {
    api.journalReglesDiag.mockResolvedValue([entree({ motifRefus: 'La fiche a changé depuis.' })]);
    await ouvrir();
    expect(await screen.findByText(/La fiche a changé depuis\./)).toBeTruthy();
  });

  it('affiche le message de l API quand l annulation est refusée', async () => {
    api.journalReglesDiag.mockResolvedValue([entree()]);
    api.annulerRegleDiag.mockRejectedValue(new Error('Cette règle n’est plus annulable.'));
    await ouvrir();
    fireEvent.click(await screen.findByRole('button', { name: /^Annuler la règle/ }));
    expect(await screen.findByText(/n’est plus annulable/)).toBeTruthy();
  });

  it('« Capitaliser cette version » : absent sans finale, actif avec, désactivé pendant une production', async () => {
    api.journalReglesDiag.mockResolvedValue([]);
    await ouvrir({ rapportLiens: [{ lien: doc, le: '2026-10-29T08:00:00.000Z', version: 4 }] });
    await screen.findByText(/Rapport remis au dirigeant/);
    expect(screen.queryByRole('button', { name: 'Capitaliser cette version' })).toBeNull();
    cleanup();
    api.capitaliserRapportDiag.mockResolvedValue(projet({ etape: 4, etapeMax: 4, dims }));
    await ouvrir();
    fireEvent.click(await screen.findByRole('button', { name: 'Capitaliser cette version' }));
    await waitFor(() => expect(api.capitaliserRapportDiag).toHaveBeenCalledWith('simatis', 'p1'));
    cleanup();
    await ouvrir({ rapportLienStatut: 'en_cours' });
    expect(
      (await screen.findByRole<HTMLButtonElement>('button', { name: 'Capitaliser cette version' }))
        .disabled,
    ).toBe(true);
  });
});

describe("Support d'ouverture : règles apprises", () => {
  const ouvrir = async (extra: Partial<ProjetDiag> = {}) => {
    api.fetchProjetsDiag.mockResolvedValue([projet({ etape: 1, etapeMax: 1, ...extra })]);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
  };
  const libelle = /Relire les deux derniers supports finaux/;

  it('la case est cochée par défaut et enregistre le réglage du support seul', async () => {
    api.reglagesDiagnostic.mockResolvedValue({ relireFinaux: true, relireSupports: true });
    api.majReglagesDiagnostic.mockResolvedValue({ relireFinaux: true, relireSupports: false });
    await ouvrir();
    const c = await screen.findByRole<HTMLInputElement>('checkbox', { name: libelle });
    await waitFor(() => expect(c.checked).toBe(true));
    fireEvent.click(c);
    await waitFor(() =>
      expect(api.majReglagesDiagnostic).toHaveBeenCalledWith('simatis', { relireSupports: false }),
    );
    await waitFor(() =>
      expect(screen.getByRole<HTMLInputElement>('checkbox', { name: libelle }).checked).toBe(false),
    );
  });

  it('« Capitaliser ce support » : absent avant l archivage, actif ensuite', async () => {
    api.reglagesDiagnostic.mockResolvedValue({ relireFinaux: true, relireSupports: true });
    await ouvrir({ supportStatut: 'pret', supportLien: 'https://claude.ai/artifact/AbCdEfGh12' });
    await screen.findByText(/Support d’ouverture/);
    expect(screen.queryByRole('button', { name: 'Capitaliser ce support' })).toBeNull();
    cleanup();
    api.capitaliserSupportDiag.mockResolvedValue(projet({ etape: 1, etapeMax: 1 }));
    await ouvrir({ supportStatut: 'final', supportLien: 'https://claude.ai/artifact/AbCdEfGh12' });
    fireEvent.click(await screen.findByRole('button', { name: 'Capitaliser ce support' }));
    await waitFor(() => expect(api.capitaliserSupportDiag).toHaveBeenCalledWith('simatis', 'p1'));
  });

  it('désactivé pendant que Claude travaille, et message de l API en cas de refus', async () => {
    api.reglagesDiagnostic.mockResolvedValue({ relireFinaux: true, relireSupports: true });
    api.capitaliserSupportDiag.mockRejectedValue(new Error('Archivez d’abord le support final.'));
    await ouvrir({ supportStatut: 'final', supportLien: 'https://claude.ai/artifact/AbCdEfGh12' });
    fireEvent.click(await screen.findByRole('button', { name: 'Capitaliser ce support' }));
    expect(await screen.findByText(/Archivez d’abord le support final/)).toBeTruthy();
    cleanup();
    await ouvrir({
      supportStatut: 'final',
      supportLien: 'https://claude.ai/artifact/AbCdEfGh12',
      statutChat: 'attente_claude',
    });
    expect(
      (await screen.findByRole<HTMLButtonElement>('button', { name: 'Capitaliser ce support' }))
        .disabled,
    ).toBe(true);
  });

  it('le journal nomme la fiche du support « règles du support »', async () => {
    api.reglagesDiagnostic.mockResolvedValue({ relireFinaux: true, relireSupports: true });
    api.journalReglesDiag.mockResolvedValue([
      {
        id: 'e9',
        le: '2026-11-05T10:00:00.000Z',
        projetId: 'p1',
        fiche: 'support',
        action: 'ajoutée',
        libelle: 'Ouvrir par le cadre de la séance',
        avant: null,
        apres: 'R',
        origine: 'support final',
        statut: 'actif',
        motifRefus: null,
      },
    ]);
    api.fetchProjetsDiag.mockResolvedValue([
      projet({ etape: 4, etapeMax: 4, dims: { outils: 2.5, strategie: 5.3, polyvalence: 9.5 } }),
    ]);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    expect(await screen.findByText(/règles du support/)).toBeTruthy();
  });
});

describe('Deck de restitution : règles apprises', () => {
  const dims = { outils: 2.5, strategie: 5.3, polyvalence: 9.5 };
  const L1 = 'https://claude.ai/artifact/DeckFictifUn';
  const L2 = 'https://claude.ai/artifact/DeckFictifDeux';
  const reglages = { relireFinaux: true, relireSupports: true, relireRestitutions: true };
  const ouvrir = async (extra: Partial<ProjetDiag> = {}) => {
    api.fetchProjetsDiag.mockResolvedValue([
      projet({
        etape: 5,
        etapeMax: 5,
        dims,
        aRapport: true,
        restitutionStatut: 'pret',
        restitutionLien: L2,
        restitutionLiens: [
          { lien: L2, le: '2026-10-26T08:00:00.000Z' },
          { lien: L1, le: '2026-10-25T08:00:00.000Z' },
        ],
        ...extra,
      }),
    ]);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
  };

  it('cocher « Version finale » sur le deck affiché appelle l API, décocher aussi', async () => {
    api.reglagesDiagnostic.mockResolvedValue(reglages);
    api.marquerDeckFinalDiag.mockResolvedValue(projet({ etape: 5, etapeMax: 5 }));
    await ouvrir();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Version finale : deck affiché' }));
    await waitFor(() =>
      expect(api.marquerDeckFinalDiag).toHaveBeenCalledWith('simatis', 'p1', L2, true),
    );
    cleanup();
    await ouvrir({
      restitutionLiens: [
        { lien: L2, le: '2026-10-26T08:00:00.000Z', finale: true },
        { lien: L1, le: '2026-10-25T08:00:00.000Z' },
      ],
    });
    const c = await screen.findByRole<HTMLInputElement>('checkbox', {
      name: 'Version finale : deck affiché',
    });
    expect(c.checked).toBe(true);
    fireEvent.click(c);
    await waitFor(() =>
      expect(api.marquerDeckFinalDiag).toHaveBeenCalledWith('simatis', 'p1', L2, false),
    );
  });

  it('un deck précédent se coche aussi, et une seule case est cochée', async () => {
    api.reglagesDiagnostic.mockResolvedValue(reglages);
    api.marquerDeckFinalDiag.mockResolvedValue(projet({ etape: 5, etapeMax: 5 }));
    await ouvrir({
      restitutionLiens: [
        { lien: L2, le: '2026-10-26T08:00:00.000Z' },
        { lien: L1, le: '2026-10-25T08:00:00.000Z', finale: true },
      ],
    });
    fireEvent.click(await screen.findByText(/Decks précédents/));
    const cochees = (await screen.findAllByRole<HTMLInputElement>('checkbox')).filter(
      (c) => c.checked && /Version finale/.test(c.getAttribute('aria-label') ?? ''),
    );
    expect(cochees).toHaveLength(1);
    expect(
      screen.getByRole<HTMLInputElement>('checkbox', { name: /Version finale : deck du/ }).checked,
    ).toBe(true);
  });

  it('la case de réglage est cochée par défaut et enregistre le réglage du deck seul', async () => {
    api.reglagesDiagnostic.mockResolvedValue(reglages);
    api.majReglagesDiagnostic.mockResolvedValue({ ...reglages, relireRestitutions: false });
    await ouvrir();
    const libelle = /Relire les deux derniers decks finaux/;
    const c = await screen.findByRole<HTMLInputElement>('checkbox', { name: libelle });
    await waitFor(() => expect(c.checked).toBe(true));
    fireEvent.click(c);
    await waitFor(() =>
      expect(api.majReglagesDiagnostic).toHaveBeenCalledWith('simatis', {
        relireRestitutions: false,
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole<HTMLInputElement>('checkbox', { name: libelle }).checked).toBe(false),
    );
  });

  it('« Capitaliser ce deck » : absent sans deck final, actif ensuite, désactivé si Claude travaille', async () => {
    api.reglagesDiagnostic.mockResolvedValue(reglages);
    await ouvrir();
    await screen.findByRole('checkbox', { name: 'Version finale : deck affiché' });
    expect(screen.queryByRole('button', { name: 'Capitaliser ce deck' })).toBeNull();
    cleanup();
    api.capitaliserDeckDiag.mockResolvedValue(projet({ etape: 5, etapeMax: 5 }));
    const finaux = [
      { lien: L2, le: '2026-10-26T08:00:00.000Z', finale: true },
      { lien: L1, le: '2026-10-25T08:00:00.000Z' },
    ];
    await ouvrir({ restitutionLiens: finaux });
    fireEvent.click(await screen.findByRole('button', { name: 'Capitaliser ce deck' }));
    await waitFor(() => expect(api.capitaliserDeckDiag).toHaveBeenCalledWith('simatis', 'p1'));
    cleanup();
    await ouvrir({ restitutionLiens: finaux, statutChat: 'attente_claude' });
    expect(
      (await screen.findByRole<HTMLButtonElement>('button', { name: 'Capitaliser ce deck' }))
        .disabled,
    ).toBe(true);
  });

  it('affiche le message de l API en cas de refus', async () => {
    api.reglagesDiagnostic.mockResolvedValue(reglages);
    api.marquerDeckFinalDiag.mockRejectedValue(new Error('Ce deck n’appartient pas à ce projet.'));
    await ouvrir();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Version finale : deck affiché' }));
    expect(await screen.findByText(/n’appartient pas à ce projet/)).toBeTruthy();
  });

  it('le journal nomme la fiche « règles du deck de restitution »', async () => {
    api.reglagesDiagnostic.mockResolvedValue(reglages);
    api.journalReglesDiag.mockResolvedValue([
      {
        id: 'e10',
        le: '2026-11-05T10:00:00.000Z',
        projetId: 'p1',
        fiche: 'restitution',
        action: 'ajoutée',
        libelle: 'Placer les options en dernière diapositive',
        avant: null,
        apres: 'R',
        origine: 'deck final',
        statut: 'actif',
        motifRefus: null,
      },
    ]);
    api.fetchProjetsDiag.mockResolvedValue([
      projet({ etape: 4, etapeMax: 4, dims: { outils: 2.5, strategie: 5.3, polyvalence: 9.5 } }),
    ]);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    expect(await screen.findByText(/règles du deck de restitution/)).toBeTruthy();
  });
});

describe("Revue : règles d'analyse", () => {
  const dims = { outils: 2.5, strategie: 5.3, polyvalence: 9.5 };
  const ouvrir = async (extra: Partial<ProjetDiag> = {}) => {
    api.fetchProjetsDiag.mockResolvedValue([
      projet({ etape: 3, etapeMax: 3, dims, profil: 'Joggeur', ...extra }),
    ]);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
  };
  const bouton = { name: 'Capitaliser cette analyse' };

  it('absent sans revue ou en brouillon, actif sur une revue validée', async () => {
    api.capitaliserAnalyseDiag.mockResolvedValue(projet({ etape: 3, etapeMax: 3, dims }));
    await ouvrir({ revue: { statut: 'brouillon' } });
    await screen.findByText('Valider la revue');
    expect(screen.queryByRole('button', bouton)).toBeNull();
    cleanup();
    await ouvrir({ revue: { statut: 'validée' } });
    fireEvent.click(await screen.findByRole('button', bouton));
    await waitFor(() => expect(api.capitaliserAnalyseDiag).toHaveBeenCalledWith('simatis', 'p1'));
  });

  it('désactivé pendant que Claude travaille, message de l API en cas de refus', async () => {
    api.capitaliserAnalyseDiag.mockRejectedValue(new Error('Validez d’abord la revue.'));
    await ouvrir({ revue: { statut: 'validée' } });
    fireEvent.click(await screen.findByRole('button', bouton));
    expect(await screen.findByText(/Validez d’abord la revue/)).toBeTruthy();
    cleanup();
    await ouvrir({ revue: { statut: 'validée' }, statutChat: 'attente_claude' });
    expect((await screen.findByRole<HTMLButtonElement>('button', bouton)).disabled).toBe(true);
  });

  it('le journal nomme la fiche d analyse « règles d analyse »', async () => {
    api.journalReglesDiag.mockResolvedValue([
      {
        id: 'e7',
        le: '2026-11-05T10:00:00.000Z',
        projetId: 'p1',
        fiche: 'analyse',
        action: 'ajoutée',
        libelle: 'Garder le plan d’action tel quel',
        avant: null,
        apres: 'R',
        origine: 'analyse validée',
        statut: 'actif',
        motifRefus: null,
      },
    ]);
    api.fetchProjetsDiag.mockResolvedValue([projet({ etape: 4, etapeMax: 4, dims })]);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    expect(await screen.findByText(/règles d’analyse/)).toBeTruthy();
  });
});

describe('Revue : préparer avec Claude', () => {
  const dims = { outils: 2.5, strategie: 5.3, polyvalence: 9.5 };
  const ouvrir = async (extra: Partial<ProjetDiag> = {}) => {
    api.fetchProjetsDiag.mockResolvedValue([
      projet({ etape: 3, etapeMax: 3, dims, profil: 'Joggeur', ...extra }),
    ]);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
  };
  const bouton = { name: 'Préparer la revue avec Claude' };

  it('présent sans revue et sur un brouillon, avec son texte d aide', async () => {
    await ouvrir({ revue: null });
    expect(await screen.findByRole('button', bouton)).toBeTruthy();
    expect(screen.getByText(/vos choix et vos textes ne sont jamais modifiés/)).toBeTruthy();
    cleanup();
    await ouvrir({ revue: { statut: 'brouillon' } });
    expect(await screen.findByRole('button', bouton)).toBeTruthy();
  });

  it('absent sur une revue validée, et sans résultat saisi', async () => {
    await ouvrir({ revue: { statut: 'validée' } });
    await screen.findByText('Valider la revue');
    expect(screen.queryByRole('button', bouton)).toBeNull();
    cleanup();
    await ouvrir({ dims: null, profil: null });
    await screen.findByText(/Pas encore de résultat/);
    expect(screen.queryByRole('button', bouton)).toBeNull();
  });

  it('appelle l API, désactivé pendant que Claude travaille, message de l API en cas de refus', async () => {
    api.preparerRevueDiag.mockResolvedValue(projet({ etape: 3, etapeMax: 3, dims }));
    await ouvrir({ revue: null });
    fireEvent.click(await screen.findByRole('button', bouton));
    await waitFor(() => expect(api.preparerRevueDiag).toHaveBeenCalledWith('simatis', 'p1'));
    cleanup();
    api.preparerRevueDiag.mockRejectedValue(new Error('La revue est validée : modifiez-la.'));
    await ouvrir({ revue: null });
    fireEvent.click(await screen.findByRole('button', bouton));
    expect(await screen.findByText(/modifiez-la/)).toBeTruthy();
    cleanup();
    await ouvrir({ revue: null, statutChat: 'attente_claude' });
    expect((await screen.findByRole<HTMLButtonElement>('button', bouton)).disabled).toBe(true);
  });
});

describe('Diagnostic : export de la revue pour Claude Chat', () => {
  const dims = { outils: 2.5, strategie: 5.3, polyvalence: 9.5 };
  const ouvrir = async (extra: Partial<ProjetDiag> = {}) => {
    api.fetchProjetsDiag.mockResolvedValue([
      projet({ etape: 3, etapeMax: 3, dims, profil: 'Joggeur', ...extra }),
    ]);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
  };
  const exporter = { name: 'Exporter la revue pour Claude Chat' };

  it('absent tant que la revue n est pas validée', async () => {
    await ouvrir({ revue: { statut: 'brouillon' } });
    await screen.findByText('Valider la revue');
    expect(screen.queryByRole('button', exporter)).toBeNull();
  });

  it('présent sur une revue validée, appelle l API et affiche son refus', async () => {
    api.exporterRevueDiag.mockResolvedValue(projet({ etape: 3, etapeMax: 3, dims }));
    await ouvrir({ revue: { statut: 'validée' } });
    fireEvent.click(await screen.findByRole('button', exporter));
    await waitFor(() => expect(api.exporterRevueDiag).toHaveBeenCalledWith('simatis', 'p1'));
    cleanup();
    api.exporterRevueDiag.mockRejectedValue(new Error('Validez d’abord la revue.'));
    await ouvrir({ revue: { statut: 'validée' } });
    fireEvent.click(await screen.findByRole('button', exporter));
    expect(await screen.findByText(/Validez d’abord la revue/)).toBeTruthy();
  });

  it('pendant l export : message d attente et bouton désactivé', async () => {
    await ouvrir({ revue: { statut: 'validée' }, revueExportStatut: 'en_cours' });
    expect(await screen.findByText(/Claude crée l’artefact de la revue/)).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', exporter).disabled).toBe(true);
  });

  it('avec un lien : ouvre l artefact et propose la mise à jour', async () => {
    await ouvrir({
      revue: { statut: 'validée' },
      revueExportStatut: 'pret',
      revueExportLien: 'https://claude.ai/artifact/RevueFictive0001',
    });
    const lien = await screen.findByRole('link', { name: 'Ouvrir la revue pour Claude Chat' });
    expect(lien.getAttribute('href')).toBe('https://claude.ai/artifact/RevueFictive0001');
    expect(screen.getByRole('button', { name: 'Mettre à jour l’export' })).toBeTruthy();
  });
});

describe('Diagnostic : dossier de travail du rapport pour Claude Chat', () => {
  const dims = { outils: 2.5, strategie: 5.3, polyvalence: 9.5 };
  const ouvrir = async (extra: Partial<ProjetDiag> = {}) => {
    api.fetchProjetsDiag.mockResolvedValue([
      projet({ etape: 4, etapeMax: 4, dims, profil: 'Joggeur', ...extra }),
    ]);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
  };
  const preparer = { name: 'Préparer le dossier pour Claude Chat' };

  it('désactivé sans résultat saisi', async () => {
    await ouvrir({ dims: null, profil: null });
    expect((await screen.findByRole<HTMLButtonElement>('button', preparer)).disabled).toBe(true);
  });

  it('appelle l API et affiche son refus', async () => {
    api.preparerDossierRapportDiag.mockResolvedValue(projet({ etape: 4, etapeMax: 4, dims }));
    await ouvrir();
    fireEvent.click(await screen.findByRole('button', preparer));
    await waitFor(() =>
      expect(api.preparerDossierRapportDiag).toHaveBeenCalledWith('simatis', 'p1'),
    );
    cleanup();
    api.preparerDossierRapportDiag.mockRejectedValue(new Error('Claude répond déjà.'));
    await ouvrir();
    fireEvent.click(await screen.findByRole('button', preparer));
    expect(await screen.findByText(/Claude répond déjà/)).toBeTruthy();
  });

  it('pendant la préparation : message d attente et bouton désactivé', async () => {
    await ouvrir({ dossierExportStatut: 'en_cours' });
    expect(await screen.findByText(/Claude prépare le dossier de travail/)).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', preparer).disabled).toBe(true);
  });

  it('avec un lien : ouvre le dossier et propose la mise à jour', async () => {
    await ouvrir({
      dossierExportStatut: 'pret',
      dossierExportLien: 'https://claude.ai/artifact/DossierFictif0001',
    });
    const lien = await screen.findByRole('link', { name: 'Ouvrir le dossier pour Claude Chat' });
    expect(lien.getAttribute('href')).toBe('https://claude.ai/artifact/DossierFictif0001');
    expect(screen.getByRole('button', { name: 'Mettre à jour le dossier' })).toBeTruthy();
  });
});
