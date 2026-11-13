import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { argumentsCodex } from './codex-mcp.js';
import {
  argumentsClaude,
  lancementCodexRoutine,
  tourEchanges,
  PARTAGE_OUTILS_LECTURE,
  WISPR_OUTILS_LECTURE,
  type Demande,
} from './runner.js';

const demande = (skill: string, cerveau = true): Demande => ({
  id: '00000000-0000-4000-8000-000000000001',
  instance: 'fictif',
  nom: 'Atelier Fictif',
  routine: 'inbox',
  libelle: 'Routine fictive',
  skill,
  cerveau,
});

describe('argumentsClaude', () => {
  it('inbox : pas de mode strict, outils = simatis + les outils Wispr et espace partagé en lecture', async () => {
    const { args } = await argumentsClaude(demande('alimenter-inbox'), 'config.json', undefined);
    expect(args).not.toContain('--strict-mcp-config');
    const outils = args[args.indexOf('--allowedTools') + 1] ?? '';
    expect(outils.split(',')).toEqual([
      'mcp__simatis__*',
      ...WISPR_OUTILS_LECTURE,
      ...PARTAGE_OUTILS_LECTURE,
    ]);
    expect(outils).not.toMatch(/deposer_message|publier_document/);
    expect(WISPR_OUTILS_LECTURE).toHaveLength(3);
    expect(outils).not.toMatch(/Gmail|HubSpot|Google_Drive|Calendar/);
  });

  it('démo (pas de second cerveau) : mode strict et aucun outil Wispr, même pour la routine Inbox', async () => {
    const { args } = await argumentsClaude(
      demande('alimenter-inbox', false),
      'config.json',
      undefined,
    );
    expect(args).toContain('--strict-mcp-config');
    expect(args.join(' ')).not.toMatch(/Wispr|partage/);
  });

  it('autre routine : mode strict conservé, aucun outil Wispr', async () => {
    const { args } = await argumentsClaude(demande('autre-skill'), 'config.json', undefined);
    expect(args).toContain('--strict-mcp-config');
    expect(args.join(' ')).not.toMatch(/Wispr|partage/);
  });

  it('inbox avec second cerveau : règles Read/Edit/Write du dossier conservées', async () => {
    const dossier = process.cwd();
    const { args } = await argumentsClaude(
      demande('alimenter-inbox', true),
      'config.json',
      dossier,
    );
    const outils = args[args.indexOf('--allowedTools') + 1] ?? '';
    expect(outils).toContain(`Read(/${dossier}/**)`);
    expect(outils).toContain(`Write(/${dossier}/**)`);
    expect(outils).toContain(WISPR_OUTILS_LECTURE[0]);
    expect(args).not.toContain('--strict-mcp-config');
  });
});

describe('routine confiée à Codex', () => {
  it("colle la skill dans la consigne, n'ouvre que les outils MCP et passe le jeton par l'environnement", async () => {
    const racine = await mkdtemp(path.join(tmpdir(), 'faux-home-'));
    const ancien = process.env.HOME;
    try {
      await mkdir(path.join(racine, '.claude', 'skills', 'skill-fictive'), { recursive: true });
      await writeFile(
        path.join(racine, '.claude', 'skills', 'skill-fictive', 'SKILL.md'),
        'Étapes fictives de la skill.',
      );
      process.env.HOME = racine;
      const l = await lancementCodexRoutine(
        demande('skill-fictive', false),
        'http://os.test',
        'jeton-fictif',
        undefined,
      );
      expect(l.args.at(-1)).toContain('Étapes fictives de la skill.');
      expect(l.args.at(-1)).toContain('skill-fictive');
      expect(l.args.join(' ')).not.toContain('jeton-fictif');
      expect(l.env).toEqual({ SIMATIS_MCP_TOKEN: 'jeton-fictif' });
      expect(l.args).toContain('read-only');
      expect(l.args).toContain('shell_tool');
      expect(l.cwd).toBeUndefined();
    } finally {
      process.env.HOME = ancien;
      await rm(racine, { recursive: true, force: true });
    }
  });
});

describe('argumentsCodex', () => {
  const base = { base: 'http://os.test', token: 'jeton-fictif', consigne: 'Consigne fictive' };

  it('limite les outils MCP à ceux demandés, sans le préfixe de Claude', () => {
    const { args } = argumentsCodex({
      ...base,
      outils: ['mcp__simatis__campagne_contexte', 'mcp__simatis__campagne_deposer', 'Read(/x/**)'],
    });
    expect(args).toContain(
      'mcp_servers.simatis.enabled_tools=["campagne_contexte","campagne_deposer"]',
    );
    expect(args).toContain('mcp_servers.simatis.url="http://os.test/mcp"');
    expect(args).toContain('mcp_servers.simatis.bearer_token_env_var="SIMATIS_MCP_TOKEN"');
    expect(args.at(-1)).toBe('Consigne fictive');
  });

  it("n'applique aucun filtre avec le joker, et garde le dossier du second cerveau en écriture seule", () => {
    const l = argumentsCodex({ ...base, outils: ['mcp__simatis__*'], cerveau: '/dossier/fictif' });
    expect(l.args.join(' ')).not.toContain('enabled_tools');
    expect(l.args).toEqual(
      expect.arrayContaining(['--sandbox', 'workspace-write', '-C', '/dossier/fictif']),
    );
    expect(l.args).not.toContain('shell_tool');
    expect(l.cwd).toBe('/dossier/fictif');
  });
});

describe('tours du runner avec le moteur choisi', () => {
  const reponses = (moteur: string, extra: Record<string, unknown>) =>
    ((url: string) => {
      const chemin = url.replace('http://os.test', '');
      const corps = extra[chemin];
      if (chemin === '/api/runner/moteur') return Promise.resolve(Response.json({ moteur }));
      if (chemin.endsWith('/demarrer')) {
        return Promise.resolve(Response.json({ tokenId: 't1', token: 'jeton-fictif' }));
      }
      return Promise.resolve(Response.json(corps ?? { ok: true }));
    }) as unknown as typeof fetch;
  const echange = {
    id: '00000000-0000-4000-8000-0000000000e1',
    instance: 'fictif',
    nom: 'Atelier Fictif',
    messages: [{ de: 'pilote', texte: 'Rappeler un contact fictif', at: '2026-11-13T09:00:00Z' }],
    brouillon: null,
  };

  it("lance Codex pour un ajout à l'Inbox quand le pilote a choisi Codex", async () => {
    const lances: { commande: string; args: string[]; env?: Record<string, string> }[] = [];
    await tourEchanges({
      base: 'http://os.test',
      token: 'runner',
      claude: 'claude-fictif',
      codex: 'codex-fictif',
      fetch: reponses('codex', { '/api/runner/echanges': [echange] }),
      lancer: (commande, args, _cwd, env) => {
        lances.push({ commande, args, ...(env ? { env } : {}) });
        return Promise.resolve(0);
      },
    });
    expect(lances).toHaveLength(1);
    expect(lances[0]?.commande).toBe('codex-fictif');
    expect(lances[0]?.args).toContain('mcp_servers.simatis.enabled_tools=["repondre_ajout"]');
    expect(lances[0]?.env).toEqual({ SIMATIS_MCP_TOKEN: 'jeton-fictif' });
  });

  it("lance Claude pour un ajout à l'Inbox quand le pilote a choisi Claude", async () => {
    const lances: string[] = [];
    await tourEchanges({
      base: 'http://os.test',
      token: 'runner',
      claude: 'claude-fictif',
      codex: 'codex-fictif',
      fetch: reponses('claude', { '/api/runner/echanges': [echange] }),
      lancer: (commande) => {
        lances.push(commande);
        return Promise.resolve(0);
      },
    });
    expect(lances).toEqual(['claude-fictif']);
  });

  it('retombe sur Claude si l’OS ne dit pas quel moteur est choisi', async () => {
    const lances: string[] = [];
    const fetchSansMoteur = ((url: string) => {
      const chemin = url.replace('http://os.test', '');
      if (chemin === '/api/runner/moteur')
        return Promise.resolve(new Response('', { status: 404 }));
      if (chemin.endsWith('/demarrer'))
        return Promise.resolve(Response.json({ tokenId: 't1', token: 'jeton-fictif' }));
      if (chemin === '/api/runner/echanges') return Promise.resolve(Response.json([echange]));
      return Promise.resolve(Response.json({ ok: true }));
    }) as unknown as typeof fetch;
    await tourEchanges({
      base: 'http://os.test',
      token: 'runner',
      claude: 'claude-fictif',
      codex: 'codex-fictif',
      fetch: fetchSansMoteur,
      lancer: (commande) => {
        lances.push(commande);
        return Promise.resolve(0);
      },
    });
    expect(lances).toEqual(['claude-fictif']);
  });

  it('nomme Codex dans l’échec quand Codex s’arrête en erreur', async () => {
    const fins: unknown[] = [];
    const f = ((url: string, init?: RequestInit) => {
      const chemin = url.replace('http://os.test', '');
      if (chemin.endsWith('/fin')) fins.push(JSON.parse(init?.body as string));
      if (chemin === '/api/runner/moteur')
        return Promise.resolve(Response.json({ moteur: 'codex' }));
      if (chemin.endsWith('/demarrer'))
        return Promise.resolve(Response.json({ tokenId: 't1', token: 'jeton-fictif' }));
      if (chemin === '/api/runner/echanges') return Promise.resolve(Response.json([echange]));
      return Promise.resolve(Response.json({ ok: true }));
    }) as unknown as typeof fetch;
    await tourEchanges({
      base: 'http://os.test',
      token: 'runner',
      claude: 'claude-fictif',
      codex: 'codex-fictif',
      fetch: f,
      lancer: () => Promise.resolve(2),
    });
    expect((fins[0] as { erreur: string }).erreur).toContain("Codex s'est arrêté");
  });
});
