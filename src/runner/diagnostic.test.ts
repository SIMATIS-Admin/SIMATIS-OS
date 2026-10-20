import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  outilsSupport,
  promptDiagnostic,
  promptSupport,
  skillsDe,
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
  demande: null,
  dateDiagnostic: '2026-11-02',
  ditParDirigeant: 'Ambition fictive',
  hypotheses: 'Hypothèse fictive',
  supportStatut: 'aucun',
  supportLien: null,
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
