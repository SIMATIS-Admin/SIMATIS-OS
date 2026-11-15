import { execFile } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { CumulReleve, JaugeReleve, Releve, SessionReleve } from '../../ia/conso/service.js';
import { cumulerParHeure, lireClaude, lireCodex, type MessageLu } from './lecture.js';

// Relevé de la consommation IA du Mac, toutes les 5 minutes : il relit en entier les sessions
// touchées depuis son dernier passage et envoie leurs cumuls à l'OS, qui les remplace. Sans état
// sur disque : un redémarrage ne fait que renvoyer les mêmes chiffres.

export type DossiersConso = { claude: string; cowork: string; codex: string };
export type OptionsConso = { base: string; token: string; fetch?: typeof fetch };
type Outil = SessionReleve['outil'];
type ChercherPr = (branche: string, cwd: string | null) => Promise<number | null>;

export const dossiersParDefaut = (): DossiersConso => ({
  claude: path.join(homedir(), '.claude', 'projects'),
  cowork: path.join(
    homedir(),
    'Library',
    'Application Support',
    'Claude',
    'local-agent-mode-sessions',
  ),
  codex: path.join(homedir(), '.codex', 'sessions'),
});

const MARGE_MS = 10 * 60_000;
const MAX_PAR_ENVOI = 5000;
// Les lancements de l'exécuteur travaillent dans un dossier temporaire « simatis-… ».
const DOSSIER_EXECUTEUR = /-T-simatis-|\/simatis-(runner|codex|ajout|campagne|diag)/;

export function classerClaude(
  chemin: string,
  dossiers: DossiersConso,
  entrypoint: string | null,
): 'code' | 'cowork' | 'executeur' {
  if (chemin.startsWith(dossiers.cowork)) return 'cowork';
  if (entrypoint === 'sdk-cli' || DOSSIER_EXECUTEUR.test(chemin)) return 'executeur';
  return 'code';
}

export function classerCodex(originator: string | null): 'codex' | 'agent' | 'executeur' {
  if (originator === 'codex_exec') return 'executeur';
  if (originator === 'codex_work_desktop') return 'agent';
  return 'codex';
}

const BRANCHES_PRINCIPALES = new Set(['main', 'master', 'HEAD']);

export async function sujetDe(
  s: { outil: string; branche: string | null; titre: string | null; cwd: string | null },
  pr: ChercherPr,
): Promise<string> {
  if (s.outil === 'cowork') return s.titre ?? 'Cowork';
  if (s.branche && !BRANCHES_PRINCIPALES.has(s.branche)) {
    const numero = await pr(s.branche, s.cwd);
    return numero ? `PR #${numero}` : s.branche;
  }
  return s.titre ?? 'question';
}

const cachePr = new Map<string, { numero: number | null; at: number }>();
const UNE_HEURE = 3_600_000;

// Numéro de PR d'une branche, par gh dans le dossier du projet ; mis en cache une heure.
export const chercherPrGh: ChercherPr = (branche, cwd) => {
  if (!cwd) return Promise.resolve(null);
  const cle = `${cwd}|${branche}`;
  const connu = cachePr.get(cle);
  if (connu && Date.now() - connu.at < UNE_HEURE) return Promise.resolve(connu.numero);
  return new Promise((resolve) => {
    execFile(
      'gh',
      ['pr', 'list', '--head', branche, '--state', 'all', '--json', 'number', '--limit', '1'],
      { cwd, timeout: 15_000 },
      (erreur, sortie) => {
        let numero: number | null = null;
        if (!erreur) {
          try {
            const liste = JSON.parse(sortie) as { number?: number }[];
            numero = typeof liste[0]?.number === 'number' ? liste[0].number : null;
          } catch {
            numero = null;
          }
        }
        cachePr.set(cle, { numero, at: Date.now() });
        resolve(numero);
      },
    );
  });
};

async function fichiers(dossier: string): Promise<{ chemin: string; mtime: number }[]> {
  const trouves: { chemin: string; mtime: number }[] = [];
  let entrees;
  try {
    entrees = await readdir(dossier, { withFileTypes: true });
  } catch {
    return trouves;
  }
  for (const e of entrees) {
    const chemin = path.join(dossier, e.name);
    if (e.isDirectory()) trouves.push(...(await fichiers(chemin)));
    else if (e.isFile() && e.name.endsWith('.jsonl')) {
      const s = await stat(chemin).catch(() => null);
      if (s) trouves.push({ chemin, mtime: s.mtimeMs });
    }
  }
  return trouves;
}

const lire = (chemin: string) => readFile(chemin, 'utf8').catch(() => '');

// Une session Claude = <projet>/<id>.jsonl et ses sous-agents <projet>/<id>/subagents/*.jsonl.
function racineClaude(chemin: string): string | null {
  const morceaux = chemin.split(path.sep);
  const i = morceaux.lastIndexOf('subagents');
  if (i > 0) return morceaux.slice(0, i).join(path.sep);
  return chemin.endsWith('.jsonl') ? chemin.slice(0, -'.jsonl'.length) : null;
}

type Unite = { session: SessionReleve; cumuls: CumulReleve[] };

async function sessionsClaude(
  dossiers: DossiersConso,
  seuil: number,
  pr: ChercherPr,
): Promise<{ unites: Unite[]; anomalies: number }> {
  const tous = [
    ...(await fichiers(dossiers.claude)),
    ...(await fichiers(dossiers.cowork)).filter((f) =>
      f.chemin.includes(`${path.sep}.claude${path.sep}projects${path.sep}`),
    ),
  ];
  const racines = new Set(
    tous.filter((f) => f.mtime >= seuil).flatMap((f) => racineClaude(f.chemin) ?? []),
  );
  const unites: Unite[] = [];
  let anomalies = 0;
  for (const racine of racines) {
    const principal = `${racine}.jsonl`;
    const sousAgents = tous.filter((f) =>
      f.chemin.startsWith(`${racine}${path.sep}subagents${path.sep}`),
    );
    const lecture = lireClaude(await lire(principal));
    anomalies += lecture.anomalies;
    const messages: MessageLu[] = [...lecture.messages];
    for (const f of sousAgents) {
      const l = lireClaude(await lire(f.chemin));
      anomalies += l.anomalies;
      messages.push(...l.messages);
    }
    if (messages.length === 0) continue;
    const id = `claude:${path.basename(racine)}`;
    const branche = messages.reduce<string | null>((b, m) => m.branche ?? b, null);
    const cwd = messages.find((m) => m.cwd)?.cwd ?? null;
    const entrypoint = lecture.messages.find((m) => m.entrypoint)?.entrypoint ?? null;
    const outil: Outil = classerClaude(principal, dossiers, entrypoint);
    const debut = new Date(Math.min(...messages.map((m) => m.at.getTime())));
    unites.push({
      session: {
        id,
        fournisseur: 'claude',
        outil,
        sujet: await sujetDe({ outil, branche, titre: lecture.titre, cwd }, pr),
        branche,
        titre: lecture.titre,
        cwd,
        debut: debut.toISOString(),
      },
      cumuls: cumulerParHeure(id, messages),
    });
  }
  return { unites, anomalies };
}

async function titresCodex(dossiers: DossiersConso): Promise<Map<string, string>> {
  const titres = new Map<string, string>();
  const contenu = await lire(path.join(dossiers.codex, '..', 'session_index.jsonl'));
  for (const ligne of contenu.split('\n')) {
    try {
      const o = JSON.parse(ligne) as { id?: unknown; thread_name?: unknown };
      if (typeof o.id === 'string' && typeof o.thread_name === 'string' && o.thread_name)
        titres.set(o.id, o.thread_name);
    } catch {
      // Index réécrit pendant la lecture : le titre reviendra au passage suivant.
    }
  }
  return titres;
}

async function sessionsCodex(
  dossiers: DossiersConso,
  seuil: number,
): Promise<{ unites: Unite[]; jauges: JaugeReleve[]; anomalies: number }> {
  const touches = (await fichiers(dossiers.codex)).filter(
    (f) => f.mtime >= seuil && path.basename(f.chemin).startsWith('rollout-'),
  );
  const titres = touches.length > 0 ? await titresCodex(dossiers) : new Map<string, string>();
  const unites: Unite[] = [];
  const jauges: JaugeReleve[] = [];
  let anomalies = 0;
  for (const f of touches) {
    const l = lireCodex(await lire(f.chemin));
    anomalies += l.anomalies;
    jauges.push(...l.jauges);
    if (!l.sessionId || l.cumuls.length === 0) continue;
    const id = `chatgpt:${l.sessionId}`;
    const outil = classerCodex(l.originator);
    const titre = titres.get(l.sessionId) ?? null;
    const debut = l.debut ?? l.cumuls[0]?.at ?? new Date();
    unites.push({
      session: {
        id,
        fournisseur: 'chatgpt',
        outil,
        sujet: outil === 'executeur' ? 'question' : (titre ?? 'question'),
        branche: null,
        titre,
        cwd: l.cwd,
        debut: debut.toISOString(),
      },
      cumuls: cumulerParHeure(id, l.cumuls),
    });
  }
  return { unites, jauges, anomalies };
}

function lots(unites: Unite[]): Unite[][] {
  const resultat: Unite[][] = [];
  let lot: Unite[] = [];
  let taille = 0;
  for (const u of unites) {
    if (
      lot.length > 0 &&
      (taille + u.cumuls.length > MAX_PAR_ENVOI || lot.length >= MAX_PAR_ENVOI)
    ) {
      resultat.push(lot);
      lot = [];
      taille = 0;
    }
    lot.push(u);
    taille += u.cumuls.length;
  }
  if (lot.length > 0) resultat.push(lot);
  return resultat;
}

export async function tourConso(
  opts: OptionsConso,
  etat: { depuis: Date },
  dossiers: DossiersConso = dossiersParDefaut(),
  pr: ChercherPr = chercherPrGh,
): Promise<void> {
  const passage = new Date();
  const seuil = etat.depuis.getTime() - MARGE_MS;
  const claude = await sessionsClaude(dossiers, seuil, pr);
  const codex = await sessionsCodex(dossiers, seuil);
  const anomalies = claude.anomalies + codex.anomalies;
  const corps = (unites: Unite[], jauges: JaugeReleve[]): Releve => ({
    passage: passage.toISOString(),
    anomalies,
    sessions: unites.map((u) => u.session),
    cumuls: unites.flatMap((u) => u.cumuls),
    jauges,
  });
  const envois: Releve[] = lots([...claude.unites, ...codex.unites]).map((l) => corps(l, []));
  for (let i = 0; i < codex.jauges.length; i += MAX_PAR_ENVOI)
    envois.push(corps([], codex.jauges.slice(i, i + MAX_PAR_ENVOI)));
  // Même sans rien de neuf, un envoi dit à l'OS que le relevé est vivant.
  if (envois.length === 0) envois.push(corps([], []));
  const doFetch = opts.fetch ?? fetch;
  for (const envoi of envois) {
    const res = await doFetch(`${opts.base}/api/runner/conso-ia`, {
      method: 'POST',
      headers: { authorization: `Bearer ${opts.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(envoi),
    });
    if (!res.ok) throw new Error(`/api/runner/conso-ia : ${res.status}`);
  }
  etat.depuis = passage;
}
