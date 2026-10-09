import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir, hostname, tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Local runner (npm run runner, started by launchd on the workstation): picks the routine runs the
// OS requested and runs each one with Claude Code, connected to the OS's MCP server through a
// temporary token limited to that run's instance.

export type Demande = {
  id: string;
  instance: string;
  nom: string;
  routine: string;
  libelle: string;
  skill: string;
};

export type RunnerOptions = {
  base: string;
  token: string;
  claude: string;
  fetch?: typeof fetch;
  // Runs the command; resolves with its exit code.
  lancer?: (commande: string, args: string[]) => Promise<number>;
  // What this workstation offers (Claude Code version, installed skills), sent at each pass.
  poste?: () => Promise<Poste>;
};

export type Poste = { nom: string; claude: string | null; skills: string[] };

export async function decrirePoste(claude: string): Promise<Poste> {
  const version = await new Promise<string | null>((resolve) => {
    execFile(claude, ['--version'], { timeout: 10_000 }, (error, stdout) =>
      resolve(error ? null : (stdout.trim().split('\n')[0] ?? null)),
    );
  });
  const dossier = path.join(homedir(), '.claude', 'skills');
  const skills = await readdir(dossier, { withFileTypes: true }).then(
    (entries) => entries.filter((e) => e.isDirectory() || e.isSymbolicLink()).map((e) => e.name),
    () => [],
  );
  return { nom: hostname(), claude: version, skills };
}

const lancerProcessus = (commande: string, args: string[]) =>
  new Promise<number>((resolve) => {
    const child = spawn(commande, args, { stdio: 'inherit' });
    child.on('error', () => resolve(127));
    child.on('exit', (code) => resolve(code ?? 1));
  });

export const prompt = (d: Demande) =>
  [
    `Utilise la skill « ${d.skill} » pour exécuter la routine « ${d.libelle} » de l'instance ${d.nom} (${d.instance}).`,
    `Identifiant d'exécution : ${d.id}. Passe-le à chaque outil qui l'accepte.`,
    'Utilise uniquement les outils MCP simatis : ils ne voient que cette instance.',
    "Signale chaque étape avec etape_routine, et termine toujours par rapport_routine (fait, en attente, échecs). N'envoie jamais rien : tout passe par des propositions à valider.",
  ].join('\n');

export async function tour(opts: RunnerOptions): Promise<number> {
  const doFetch = opts.fetch ?? fetch;
  const lancer = opts.lancer ?? lancerProcessus;
  const headers = { authorization: `Bearer ${opts.token}`, 'content-type': 'application/json' };
  const api = async <T>(chemin: string, body?: unknown): Promise<T> => {
    const res = await doFetch(`${opts.base}${chemin}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok) throw new Error(`${chemin} : ${res.status}`);
    return (await res.json()) as T;
  };

  await api('/api/runner/presence', await (opts.poste ?? (() => decrirePoste(opts.claude)))());
  const demandes = await api<Demande[]>('/api/runner/demandes');
  for (const d of demandes) {
    let demarre: { tokenId: string; token: string };
    try {
      demarre = await api(`/api/runner/executions/${d.id}/demarrer`, { instance: d.instance });
    } catch {
      continue; // Started by another runner meanwhile.
    }
    const dossier = await mkdtemp(path.join(tmpdir(), 'simatis-runner-'));
    const config = path.join(dossier, 'mcp.json');
    let erreur: string | undefined;
    try {
      await writeFile(
        config,
        JSON.stringify({
          mcpServers: {
            simatis: {
              type: 'http',
              url: `${opts.base}/mcp`,
              headers: { Authorization: `Bearer ${demarre.token}` },
            },
          },
        }),
        { mode: 0o600 },
      );
      const code = await lancer(opts.claude, [
        '-p',
        prompt(d),
        '--mcp-config',
        config,
        '--strict-mcp-config',
        '--allowedTools',
        'mcp__simatis__*',
      ]);
      if (code !== 0) erreur = `Claude s'est arrêté avec le code ${code}.`;
    } finally {
      await rm(dossier, { recursive: true, force: true });
      // Revokes the token; a run left open without a report is marked failed.
      await api(`/api/runner/executions/${d.id}/fin`, {
        instance: d.instance,
        tokenId: demarre.tokenId,
        ...(erreur ? { erreur } : {}),
      });
    }
  }
  return demandes.length;
}

function main() {
  const token = process.env.RUNNER_TOKEN;
  if (!token) {
    console.error('RUNNER_TOKEN manquant : npm run admin -- token:create --nom runner --runner');
    process.exit(1);
  }
  const opts = {
    base: process.env.SIMATIS_URL ?? 'http://127.0.0.1:4300',
    token,
    claude: process.env.CLAUDE_BIN ?? 'claude',
  };
  const every = Number(process.env.RUNNER_INTERVAL_MS ?? 30_000);
  let occupe = false;
  const passe = () => {
    if (occupe) return;
    occupe = true;
    tour(opts)
      .catch((err: unknown) => console.error('runner :', err instanceof Error ? err.message : err))
      .finally(() => {
        occupe = false;
      });
  };
  passe();
  setInterval(passe, every);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
