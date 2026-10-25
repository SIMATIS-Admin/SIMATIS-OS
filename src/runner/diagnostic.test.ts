import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  depuisDerniereProduction,
  outilsEntretien,
  outilsRapport,
  outilsRestitution,
  outilsSupport,
  promptDiagnostic,
  promptEntretien,
  promptRapport,
  promptRestitution,
  promptSupport,
  skillsDe,
  SKILL_RAPPORT,
  SKILL_SUPPORT,
  tourDiagnostic,
  type AttenteDiag,
} from './runner.js';

const attente: AttenteDiag = {
  id: '00000000-0000-4000-8000-000000000001',
  instance: 'simatis',
  nom: 'Atelier Fictif',
  activite: 'Autre activité',
  contexte: 'Contexte fictif.',
  etape: 2,
  profil: 'Joggeur',
  dims: { outils: 2.5, strategie: 5.3, polyvalence: 9.5 },
  statutDiagnostic: 'Rapport à rédiger',
  revue: { statut: 'brouillon' },
  conversation: [
    { etape: 1, de: 'pilote', texte: 'Ancienne question', at: '2026-10-18T08:00:00.000Z' },
    { etape: 2, de: 'pilote', texte: 'Question fictive', at: '2026-10-19T08:00:00.000Z' },
  ],
  etapeMessage: 2,
  modele: 'sonnet',
  effort: 'moyen',
  demande: null,
  dateDiagnostic: '2026-11-02',
  ditParDirigeant: 'Ambition fictive',
  hypotheses: 'Hypothèse fictive',
  supportStatut: 'aucun',
  supportLien: null,
  rapportLien: null,
  rapportLienStatut: 'aucun',
  rapportVersion: null,
  rapportContenu: null,
  rapportNom: null,
  restitutionLien: null,
  restitutionAvecProposition: true,
  pdf: null,
  logo: null,
};

describe('Prompt du chat de diagnostic', () => {
  it('demande une seule réponse via l outil, pour ce projet et cette étape', () => {
    const texte = promptDiagnostic(attente, new Date('2026-10-19T08:00:00Z'));
    expect(texte).toContain(`projetId ${attente.id}`);
    expect(texte).toContain('repondre_diagnostic');
    expect(texte).toContain('étape 2 sur 5');
  });

  it("ne reprend que l'échange de l'étape en cours", () => {
    const texte = promptDiagnostic(attente);
    expect(texte).toContain('Question fictive');
    expect(texte).not.toContain('Ancienne question');
  });
});

describe('Skills du poste', () => {
  it('compte aussi les skills synchronisées depuis claude.ai', async () => {
    const dossier = await mkdtemp(path.join(tmpdir(), 'skills-'));
    await mkdir(path.join(dossier, 'alimenter-inbox'));
    await mkdir(path.join(dossier, 'synced', 'compte-fictif', 'skill-synchronisee'), {
      recursive: true,
    });
    expect((await skillsDe(dossier)).sort()).toEqual(['alimenter-inbox', 'skill-synchronisee']);
    await rm(dossier, { recursive: true, force: true });
  });

  it('rend une liste vide sans dossier de skills', async () => {
    expect(await skillsDe(path.join(tmpdir(), 'absent-' + Date.now()))).toEqual([]);
  });
});

describe('Support d ouverture par le runner', () => {
  const preparer: AttenteDiag = {
    ...attente,
    etape: 1,
    etapeMessage: 1,
    demande: 'preparer_support',
    logo: { nom: 'Logo Fictif.PNG', base64: Buffer.from('png').toString('base64') },
  };

  it('demande de créer un deck à partir du modèle, sans jamais toucher au modèle', () => {
    const texte = promptSupport(preparer, 'logo.png', null);
    expect(texte).toContain(SKILL_SUPPORT);
    expect(texte).toContain('Ne modifie jamais le deck modèle');
    expect(texte).toContain("n'utilise jamais la réserve d'images");
    expect(texte).toContain('trois recherches web au maximum');
    expect(texte).toContain('Ambition fictive');
    expect(texte).toContain('fichier logo.png');
    expect(texte).toContain('Second cerveau non accessible');
  });

  it('sur « Support final », demande de relire le deck publié et d en rendre le texte', () => {
    const texte = promptSupport(
      { ...preparer, demande: 'support_final', supportLien: 'https://claude.ai/artifact/Fictif01' },
      null,
      '/cerveau-fictif',
    );
    expect(texte).toContain('Relis le deck publié');
    expect(texte).toContain('diapositives');
    expect(texte).toContain('Second cerveau : /cerveau-fictif');
  });

  it('n ouvre les fichiers qu au dossier de travail et au second cerveau, par des règles Edit', () => {
    expect(outilsSupport(null, ['/travail'])).toContain('Edit(//travail/**)');
    expect(outilsSupport(null, ['/travail'])).not.toContain('cerveau');
    const avec = outilsSupport('/cerveau-fictif', ['/travail']);
    expect(avec).toContain('Read(//cerveau-fictif/**)');
    expect(avec).toContain('Edit(//cerveau-fictif/**)');
    // Claude Code ignore les règles Write sur les fichiers.
    expect(avec).not.toContain('Write(');
  });

  const fauxOs = (a: AttenteDiag, appels: { url: string; body: unknown }[]) =>
    ((url: string, init?: RequestInit) => {
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      appels.push({ url, body });
      const reponse = url.endsWith('/attentes')
        ? [a]
        : url.endsWith('/demarrer')
          ? { tokenId: 't1', token: 'jeton-fictif' }
          : { ok: true };
      return Promise.resolve(new Response(JSON.stringify(reponse), { status: 200 }));
    }) as typeof fetch;

  const lanceAvec = async (a: AttenteDiag) => {
    let args: string[] = [];
    await tourDiagnostic({
      base: 'http://os.test',
      token: 'r',
      claude: 'claude',
      fetch: fauxOs(a, []),
      poste: () =>
        Promise.resolve({ nom: 'poste', claude: '1', skills: [SKILL_SUPPORT, SKILL_RAPPORT] }),
      lancer: (_c, a2) => {
        args = a2;
        return Promise.resolve(0);
      },
    });
    return args;
  };

  it('passe le modèle et l effort choisis dans le chat à Claude', async () => {
    const args = await lanceAvec({ ...attente, modele: 'opus', effort: 'max' });
    expect(args.slice(args.indexOf('--model'), args.indexOf('--model') + 4)).toEqual([
      '--model',
      'opus',
      '--effort',
      'max',
    ]);
    const eleve = await lanceAvec({ ...attente, modele: 'sonnet', effort: 'eleve' });
    expect(eleve[eleve.indexOf('--effort') + 1]).toBe('high');
  });

  it('lance la création du deck de restitution avec Artifact et ses outils', async () => {
    const args = await lanceAvec({
      ...attente,
      etape: 5,
      etapeMessage: 5,
      demande: 'restitution',
      modele: 'fable',
      effort: 'moyen',
      conversation: [
        {
          etape: 5,
          de: 'pilote',
          texte: 'Produire le deck de restitution.',
          at: '2026-10-25T08:00:00Z',
        },
      ],
    });
    expect(args[args.indexOf('--model') + 1]).toBe('fable');
    expect(args[args.indexOf('--allowedTools') + 1]).toContain(
      'mcp__simatis__enregistrer_restitution',
    );
    expect(args[args.indexOf('--tools') + 1]).toContain('Artifact');
  });

  it('lance Claude avec la skill, l outil Artifact et le logo dans le dossier de travail', async () => {
    const appels: { url: string; body: unknown }[] = [];
    let vu:
      { args: string[]; cwd?: string; env?: Record<string, string>; logo?: boolean } | undefined;
    await tourDiagnostic({
      base: 'http://os.test',
      token: 'r',
      claude: 'claude',
      fetch: fauxOs(preparer, appels),
      poste: () => Promise.resolve({ nom: 'poste', claude: '1', skills: [SKILL_SUPPORT] }),
      lancer: async (_c, args, cwd, env) => {
        const { stat } = await import('node:fs/promises');
        vu = { args, cwd, env, logo: await stat(path.join(cwd!, 'logo.png')).then(() => true) };
        return 0;
      },
    });
    expect(vu?.logo).toBe(true);
    // Hors de l'app de bureau, l'outil Artifact n'existe qu'avec cette variable.
    expect(vu?.env).toEqual({ CLAUDE_CODE_ARTIFACT: '1' });
    // Publier sur le deck sans confirmation, sans jamais offrir le terminal.
    expect(vu!.args.join(' ')).toContain('--permission-mode acceptEdits');
    const integres = vu!.args[vu!.args.indexOf('--tools') + 1];
    expect(integres).toContain('Artifact');
    expect(integres).not.toContain('Bash');
    const outils = vu!.args[vu!.args.indexOf('--allowedTools') + 1];
    expect(outils).toContain('Artifact');
    expect(outils).toContain('mcp__simatis__enregistrer_support');
    expect(appels.at(-1)?.body).not.toHaveProperty('erreur');
  });

  it('sans la skill sur le poste, ne lance rien et prévient le pilote', async () => {
    const appels: { url: string; body: unknown }[] = [];
    let lance = false;
    await tourDiagnostic({
      base: 'http://os.test',
      token: 'r',
      claude: 'claude',
      fetch: fauxOs(preparer, appels),
      poste: () => Promise.resolve({ nom: 'poste', claude: '1', skills: [] }),
      lancer: () => {
        lance = true;
        return Promise.resolve(0);
      },
    });
    expect(lance).toBe(false);
    const fin = appels.at(-1)?.body as { erreur?: string };
    expect(fin.erreur).toContain(SKILL_SUPPORT);
  });

  it('un message des étapes suivantes reste une simple réponse', async () => {
    let outils = '';
    await tourDiagnostic({
      base: 'http://os.test',
      token: 'r',
      claude: 'claude',
      fetch: fauxOs(attente, []),
      poste: () => Promise.resolve({ nom: 'poste', claude: '1', skills: [SKILL_SUPPORT] }),
      lancer: (_c, args) => {
        outils = args[args.indexOf('--allowedTools') + 1]!;
        return Promise.resolve(0);
      },
    });
    expect(outils).toBe('mcp__simatis__repondre_diagnostic');
  });
});

describe('Production par le runner : modifications et deck', () => {
  const base: AttenteDiag = { ...attente, etape: 4, etapeMessage: 4, demande: 'rapport' };
  const msg = (etape: number, de: 'pilote' | 'claude', texte: string) => ({
    etape,
    de,
    texte,
    at: '2026-10-25T08:00:00Z',
  });

  it('ne retient que les messages écrits depuis la production précédente', () => {
    const a: AttenteDiag = {
      ...base,
      conversation: [
        msg(4, 'pilote', 'Ancienne demande déjà intégrée'),
        msg(4, 'claude', 'Noté'),
        msg(4, 'pilote', 'Produire le rapport version 1.'),
        msg(4, 'pilote', 'Ajoute le sujet des tarifs'),
        msg(4, 'claude', 'Noté : tarifs'),
        msg(5, 'pilote', 'Message d une autre étape'),
        msg(4, 'pilote', 'Produire le rapport version 2.'),
      ],
    };
    expect(depuisDerniereProduction(a, 4, 'Produire le rapport version')).toEqual([
      'Pilote : Ajoute le sujet des tarifs',
      'Toi : Noté : tarifs',
    ]);
  });

  it('à la première production, reprend tout l échange de l étape', () => {
    const a: AttenteDiag = {
      ...base,
      conversation: [
        msg(4, 'pilote', 'Premier avis'),
        msg(4, 'pilote', 'Produire le rapport version 1.'),
      ],
    };
    expect(depuisDerniereProduction(a, 4, 'Produire le rapport version')).toEqual([
      'Pilote : Premier avis',
    ]);
  });

  it('le rapport est révisé à partir de la version précédente et des modifications', () => {
    const a: AttenteDiag = {
      ...base,
      rapportVersion: 2,
      rapportContenu: { entreprise: 'Atelier Fictif Nord' },
      conversation: [
        msg(4, 'pilote', 'Insiste sur la fidélisation'),
        msg(4, 'pilote', 'Produire le rapport version 3.'),
      ],
    };
    const texte = promptRapport(a, null, new Date('2026-10-25T08:00:00Z'));
    expect(texte).toContain('Rapport précédent (version 2');
    expect(texte).toContain('Atelier Fictif Nord');
    expect(texte).toContain('Pilote : Insiste sur la fidélisation');
  });

  it('un Word importé est signalé sans contenu', () => {
    const texte = promptRapport({ ...base, rapportNom: 'importe.docx' }, null);
    expect(texte).toContain('un Word importé (importe.docx)');
  });

  it('les chats des étapes 4 et 5 recueillent sans rien produire', () => {
    const chat4 = promptDiagnostic({ ...base, rapportContenu: { a: 1 }, rapportVersion: 1 });
    expect(chat4).toContain('Tu ne rédiges pas le rapport ici');
    expect(chat4).toContain('Rapport actuel (version 1');
    const chat5 = promptDiagnostic({ ...base, etape: 5, etapeMessage: 5, demande: null });
    expect(chat5).toContain('Tu ne crées pas le deck ici');
    expect(promptDiagnostic({ ...base, etape: 2, etapeMessage: 2 })).not.toContain('Tu ne ');
  });

  const restitution: AttenteDiag = {
    ...base,
    etape: 5,
    etapeMessage: 5,
    demande: 'restitution',
    rapportVersion: 1,
    rapportContenu: { entreprise: 'Atelier Fictif Nord' },
    restitutionLien: null,
    restitutionAvecProposition: true,
    conversation: [
      msg(5, 'pilote', 'Premier cycle de trois mois, forfait fictif de 1 000 euros'),
      msg(5, 'pilote', 'Produire le deck de restitution.'),
    ],
  };

  it('le deck de restitution reprend le rapport, dure moins d une heure et finit sur la proposition', () => {
    const texte = promptRestitution(restitution, new Date('2026-10-25T08:00:00Z'));
    expect(texte).toContain("moins d'une heure");
    expect(texte).toContain('le score');
    expect(texte).toContain('Atelier Fictif Nord');
    expect(texte).toContain('Dernière diapositive : la proposition de collaboration');
    expect(texte).toContain('forfait fictif de 1 000 euros');
    expect(texte).toContain('intent « slides »');
    expect(texte).toContain('enregistrer_restitution');
  });

  it('sans proposition, le deck ne contient ni offre ni tarif', () => {
    const texte = promptRestitution({ ...restitution, restitutionAvecProposition: false });
    expect(texte).toContain('sans aucune offre ni tarif');
    expect(texte).not.toContain('forfait fictif');
  });

  it('sans élément donné, aucun tarif n est inventé', () => {
    const texte = promptRestitution({ ...restitution, conversation: [] });
    expect(texte).toContain('ne rédige pas de tarif');
  });

  it('un deck existant est révisé, pas recréé', () => {
    const texte = promptRestitution({
      ...restitution,
      restitutionLien: 'https://claude.ai/artifact/RestitutionFictive01',
    });
    expect(texte).toContain('révise le deck existant');
  });

  it('les outils du deck sont ceux de la restitution seulement', () => {
    const outils = outilsRestitution(['/travail']);
    expect(outils).toContain('mcp__simatis__enregistrer_restitution');
    expect(outils).toContain('Artifact');
    expect(outils).not.toContain('enregistrer_rapport');
    expect(outils).not.toContain('enregistrer_support');
  });
});

describe('Rapport par le runner', () => {
  const rapport: AttenteDiag = {
    ...attente,
    etape: 4,
    etapeMessage: 4,
    demande: 'rapport',
    rapportLien: null,
    rapportLienStatut: 'en_cours',
  };

  it('demande la skill du rapport, rendu structuré sans artifact ni fichier', () => {
    const texte = promptRapport(rapport, null, new Date('2026-10-20T08:00:00Z'));
    expect(texte).toContain(SKILL_RAPPORT);
    expect(texte).toContain(`projetId ${rapport.id}`);
    expect(texte).toContain('enregistrer_rapport');
    expect(texte).toContain('ni formulaire, ni artifact, ni fichier');
    expect(promptRapport({ ...rapport, revue: null }, null)).toContain(
      'aucune : fonde-toi sur le résultat',
    );
    expect(texte).toContain('Second cerveau non accessible');
  });

  it('ne donne que l outil du rapport, jamais celui du support', () => {
    const outils = outilsRapport(null, ['/travail']);
    expect(outils).toContain('mcp__simatis__enregistrer_rapport');
    expect(outils).not.toContain('enregistrer_support');
    expect(outils).not.toContain('Artifact');
    const avec = outilsRapport('/cerveau-fictif', ['/travail']);
    expect(avec).toContain('Read(//cerveau-fictif/**)');
    // Le second cerveau se lit seulement pour le rapport : aucune règle Edit dessus.
    expect(avec).not.toContain('Edit(//cerveau-fictif/**)');
  });
});

describe('Entretien par le runner', () => {
  const entretien: AttenteDiag = {
    ...attente,
    etape: 2,
    etapeMessage: 2,
    demande: 'entretien',
    pdf: { nom: 'entretien.pdf', base64: Buffer.from('%PDF-1.4 fictif').toString('base64') },
  };
  const grille = {
    seuil: 6,
    questions: [
      {
        section: 'Rubrique fictive',
        numero: 3,
        libelle: 'Question fictive trois',
        dimension: 'outils' as const,
        poids: 2,
      },
    ],
  };

  it('demande de lire le PDF, question par question, et de ne rien inventer', () => {
    const texte = promptEntretien(entretien, grille, new Date('2026-10-20T08:00:00Z'));
    expect(texte).toContain(`projetId ${entretien.id}`);
    expect(texte).toContain('enregistrer_reponses_entretien');
    expect(texte).toContain('Question fictive trois');
    expect(texte).toContain('N/A');
    expect(texte).toContain("n'invente rien");
  });

  it('ne donne que la lecture et les deux outils du projet, jamais le deck ni l édition', () => {
    const outils = outilsEntretien();
    expect(outils).toContain('mcp__simatis__enregistrer_reponses_entretien');
    expect(outils).toContain('Read');
    expect(outils).not.toContain('Artifact');
    expect(outils).not.toContain('Edit');
  });
});
