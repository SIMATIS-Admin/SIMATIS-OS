import type { CumulReleve, JaugeReleve, Jetons } from '../../ia/conso/service.js';

// Lecture des fichiers de session que Claude Code, Cowork et Codex laissent sur le Mac. On n'en
// garde que des compteurs, des heures, des identifiants, le modèle, la branche, le dossier et le
// titre : jamais le contenu des conversations.

export type MessageLu = {
  sessionId: string;
  at: Date;
  modele: string;
  jetons: Jetons;
  branche: string | null;
  cwd: string | null;
  entrypoint: string | null;
};
export type LectureClaude = { messages: MessageLu[]; titre: string | null; anomalies: number };
export type LectureCodex = {
  sessionId: string;
  originator: string | null;
  cwd: string | null;
  debut: Date | null;
  cumuls: { at: Date; modele: string; jetons: Jetons }[];
  jauges: JaugeReleve[];
  anomalies: number;
};

type Objet = Record<string, unknown>;
const objet = (v: unknown): Objet | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Objet) : null;
const texte = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const nombre = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const date = (v: unknown): Date | null => {
  const s = texte(v);
  const d = s ? new Date(s) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

function lignes(contenu: string): { objets: Objet[]; anomalies: number } {
  const objets: Objet[] = [];
  let anomalies = 0;
  const morceaux = contenu.split('\n');
  // Sans fin de ligne, le dernier morceau est en cours d'écriture par l'outil : on l'ignore.
  if (!contenu.endsWith('\n')) morceaux.pop();
  for (const ligne of morceaux) {
    if (ligne.trim() === '') continue;
    try {
      const o = objet(JSON.parse(ligne));
      if (o) objets.push(o);
      else anomalies++;
    } catch {
      // Ligne en cours d'écriture ou format changé : comptée, la suite du fichier reste lue.
      anomalies++;
    }
  }
  return { objets, anomalies };
}

export function lireClaude(contenu: string): LectureClaude {
  const { objets, anomalies } = lignes(contenu);
  // Un même message s'écrit sur plusieurs lignes (un bloc de contenu par ligne) avec le même usage.
  const parMessage = new Map<string, MessageLu>();
  let titre: string | null = null;
  for (const o of objets) {
    if (o.type === 'custom-title') titre = texte(o.customTitle) ?? titre;
    if (o.type !== 'assistant') continue;
    const message = objet(o.message);
    const usage = objet(message?.usage);
    const at = date(o.timestamp);
    const sessionId = texte(o.sessionId);
    if (!message || !usage || !at || !sessionId) continue;
    const cle = texte(message.id) ?? texte(o.uuid);
    if (!cle) continue;
    parMessage.set(cle, {
      sessionId,
      at: parMessage.get(cle)?.at ?? at,
      modele: texte(message.model) ?? 'inconnu',
      jetons: {
        entree: nombre(usage.input_tokens),
        sortie: nombre(usage.output_tokens),
        cacheEcriture: nombre(usage.cache_creation_input_tokens),
        cacheLecture: nombre(usage.cache_read_input_tokens),
      },
      branche: texte(o.gitBranch),
      cwd: texte(o.cwd),
      entrypoint: texte(o.entrypoint),
    });
  }
  return { messages: [...parMessage.values()], titre, anomalies };
}

export function lireCodex(contenu: string): LectureCodex {
  const { objets, anomalies } = lignes(contenu);
  const lecture: LectureCodex = {
    sessionId: '',
    originator: null,
    cwd: null,
    debut: null,
    cumuls: [],
    jauges: [],
    anomalies,
  };
  let modele = 'inconnu';
  let precedent = { entree: 0, cacheLecture: 0, cacheEcriture: 0, sortie: 0 };
  for (const o of objets) {
    const payload = objet(o.payload);
    if (!payload) continue;
    if (o.type === 'session_meta') {
      lecture.sessionId = texte(payload.id) ?? texte(payload.session_id) ?? lecture.sessionId;
      lecture.originator = texte(payload.originator);
      lecture.cwd = texte(payload.cwd);
      lecture.debut = date(payload.timestamp) ?? date(o.timestamp);
    } else if (o.type === 'turn_context') {
      modele = texte(payload.model) ?? modele;
    } else if (o.type === 'event_msg' && payload.type === 'token_count') {
      const at = date(o.timestamp);
      if (!at) continue;
      // Les compteurs de Codex sont cumulés depuis le début de la session : on garde les écarts.
      const total = objet(objet(payload.info)?.total_token_usage);
      if (total) {
        const lecture5 = nombre(total.cached_input_tokens);
        const ecriture = nombre(total.cache_write_input_tokens);
        const courant = {
          entree: Math.max(0, nombre(total.input_tokens) - lecture5 - ecriture),
          cacheLecture: lecture5,
          cacheEcriture: ecriture,
          sortie: nombre(total.output_tokens),
        };
        const ecart = {
          entree: Math.max(0, courant.entree - precedent.entree),
          sortie: Math.max(0, courant.sortie - precedent.sortie),
          cacheEcriture: Math.max(0, courant.cacheEcriture - precedent.cacheEcriture),
          cacheLecture: Math.max(0, courant.cacheLecture - precedent.cacheLecture),
        };
        precedent = courant;
        if (ecart.entree + ecart.sortie + ecart.cacheEcriture + ecart.cacheLecture > 0)
          lecture.cumuls.push({ at, modele, jetons: ecart });
      }
      const limites = objet(payload.rate_limits);
      const primaire = objet(limites?.primary);
      const secondaire = objet(limites?.secondary);
      if (primaire && secondaire) {
        const reset = (v: unknown) =>
          typeof v === 'number' ? new Date(v * 1000).toISOString() : null;
        lecture.jauges.push({
          fournisseur: 'chatgpt',
          at: at.toISOString(),
          utilise5h: nombre(primaire.used_percent),
          utiliseHebdo: nombre(secondaire.used_percent),
          reset5h: reset(primaire.resets_at),
          resetHebdo: reset(secondaire.resets_at),
        });
      }
    }
  }
  return lecture;
}

const HEURE_MS = 3_600_000;

export function cumulerParHeure(
  sessionId: string,
  messages: { at: Date; modele: string; jetons: Jetons }[],
): CumulReleve[] {
  const cumuls = new Map<string, CumulReleve>();
  for (const m of messages) {
    const heure = new Date(Math.floor(m.at.getTime() / HEURE_MS) * HEURE_MS).toISOString();
    const cle = `${heure}|${m.modele}`;
    const c = cumuls.get(cle) ?? {
      sessionId,
      heure,
      modele: m.modele,
      entree: 0,
      sortie: 0,
      cacheEcriture: 0,
      cacheLecture: 0,
    };
    c.entree += m.jetons.entree;
    c.sortie += m.jetons.sortie;
    c.cacheEcriture += m.jetons.cacheEcriture;
    c.cacheLecture += m.jetons.cacheLecture;
    cumuls.set(cle, c);
  }
  return [...cumuls.values()].sort((a, b) => a.heure.localeCompare(b.heure));
}
