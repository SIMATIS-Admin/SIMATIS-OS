// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjetDiag } from '../api.js';
import { Diagnostic, entreesRevue, modifierRevue } from './Diagnostic.js';

const api = vi.hoisted(() => ({
  fetchProjetsDiag: vi.fn(),
  creerProjetDiag: vi.fn(),
  majProjetDiag: vi.fn(),
  envoyerMessageDiag: vi.fn(),
  demandeSupportDiag: vi.fn(),
  demandeRapportDiag: vi.fn(),
  importerEntretienDiag: vi.fn(),
  corrigerReponseDiag: vi.fn(),
  urlLogoDiag: (slug: string, id: string) => `/api/i/${slug}/diagnostic/projets/${id}/logo`,
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
      expect(api.creerProjetDiag).toHaveBeenCalledWith('simatis', 'Bureau Fictif', 'services'),
    );
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
    expect(screen.getByText(/Claude prépare sa réponse/)).toBeTruthy();
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
  const revueValidee = { statut: 'validée', libre: 'Remarque fictive.' };
  const dims = { outils: 2.5, strategie: 5.3, polyvalence: 9.5 };

  it('désactive le bouton et dit pourquoi tant que la revue n est pas validée', async () => {
    api.fetchProjetsDiag.mockResolvedValue([
      projet({ etape: 4, etapeMax: 4, dims, profil: 'Joggeur', revue: { statut: 'brouillon' } }),
    ]);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    const bouton = await screen.findByRole('button', { name: 'Produire le rapport' });
    expect((bouton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Validez d'abord la revue/)).toBeTruthy();
  });

  it('active le bouton une fois le résultat saisi et la revue validée, puis demande le rapport', async () => {
    api.fetchProjetsDiag.mockResolvedValue([
      projet({ etape: 4, etapeMax: 4, dims, profil: 'Joggeur', revue: revueValidee }),
    ]);
    api.demandeRapportDiag.mockResolvedValue(
      projet({
        etape: 4,
        etapeMax: 4,
        dims,
        profil: 'Joggeur',
        revue: revueValidee,
        rapportLienStatut: 'en_cours',
      }),
    );
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    const bouton = await screen.findByRole('button', { name: 'Produire le rapport' });
    expect((bouton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(bouton);
    await waitFor(() => expect(api.demandeRapportDiag).toHaveBeenCalledWith('simatis', 'p1'));
    expect(await screen.findByText(/Claude rédige le rapport/)).toBeTruthy();
  });

  it('ouvre le rapport rédigé dans un nouvel onglet', async () => {
    api.fetchProjetsDiag.mockResolvedValue([
      projet({
        etape: 4,
        etapeMax: 4,
        dims,
        profil: 'Joggeur',
        revue: revueValidee,
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
  const dims = { outils: 7.5, strategie: 5.4, polyvalence: 9.5 };
  const reponses: ProjetDiag['reponsesEntretien'] = [
    { section: 'R1', numero: 1, reponse: 'A' },
    { section: 'R2', numero: 1, reponse: 'C' },
  ];

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

  it('liste les réponses lues et une correction les renvoie à l OS', async () => {
    api.fetchProjetsDiag.mockResolvedValue([
      projet({
        etape: 2,
        etapeMax: 2,
        dims,
        profil: 'Sprinteur',
        aPdfEntretien: true,
        reponsesEntretien: reponses,
      }),
    ]);
    api.corrigerReponseDiag.mockResolvedValue(
      projet({
        etape: 2,
        etapeMax: 2,
        dims,
        profil: 'Sprinteur',
        aPdfEntretien: true,
        reponsesEntretien: reponses,
      }),
    );
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    const choix = await screen.findByLabelText('Réponse R1 n° 1');
    fireEvent.change(choix, { target: { value: 'B' } });
    await waitFor(() => expect(api.corrigerReponseDiag).toHaveBeenCalled());
    expect(api.corrigerReponseDiag).toHaveBeenCalledWith('simatis', 'p1', {
      section: 'R1',
      numero: 1,
      reponse: 'B',
    });
  });

  it('garde la saisie manuelle des trois notes comme secours', async () => {
    api.fetchProjetsDiag.mockResolvedValue([projet({ etape: 2, etapeMax: 2 })]);
    render(<Diagnostic slug="simatis" />);
    fireEvent.click(await screen.findByRole('button', { name: /Atelier Fictif Nord/ }));
    expect(await screen.findByRole('button', { name: 'Enregistrer le résultat' })).toBeTruthy();
  });
});
