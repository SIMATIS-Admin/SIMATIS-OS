import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type LancerTexte = (
  commande: string,
  args: string[],
) => Promise<{ code: number; stdout: string }>;
type Api = <T>(chemin: string, corps?: unknown) => Promise<T>;

type VisioAResumer = {
  id: string;
  instance: string;
  titre: string;
  transcript: string;
  debut?: string | null;
  fin?: string | null;
  participants?: string[];
  // Reconnus dans le CRM par l'OS : le compte rendu les nomme et les accorde.
  interlocuteurs?: { nom: string; entreprise: string | null }[];
};

// Prompts et glossaire sont des fichiers relus à chaque passage : Marc les modifie sans recompiler.
export type Ressources = {
  synthese: () => Promise<string>;
  extraction: () => Promise<string>;
  glossaire: () => Promise<string>;
};

const REESSAI_MS = 10 * 60_000;
// Dernier essai par visio : un échec de Claude ne relance pas une tâche coûteuse toutes les quelques secondes.
const dernierEssai = new Map<string, number>();

// Claude sans aucun outil : en mode non interactif, tout outil non autorisé est refusé, et le
// transcript ne peut donc rien déclencher.
export const lancerClaudeTexte: LancerTexte = (commande, args) =>
  new Promise((resolve) => {
    execFile(
      commande,
      args,
      { maxBuffer: 10 * 1024 * 1024, timeout: 10 * 60_000 },
      (erreur, stdout) => resolve({ code: erreur ? 1 : 0, stdout }),
    );
  });

const DOSSIER_RESSOURCES = fileURLToPath(new URL('../../Resources/', import.meta.url));
const lireSiPresent = (chemin: string) => readFile(chemin, 'utf8').catch(() => '');

// Le glossaire (noms réels) vit dans le second cerveau privé, jamais dans ce dépôt public.
export function ressourcesDuPoste(
  cerveau: string | undefined = process.env.SECOND_CERVEAU_DIR,
): Ressources {
  const requis = async (nom: string) => {
    const texte = await lireSiPresent(path.join(DOSSIER_RESSOURCES, nom));
    if (!texte) throw new Error(`Prompt introuvable : Resources/${nom}`);
    return texte;
  };
  return {
    synthese: () => requis('prompt-synthese-visio.md'),
    extraction: () => requis('prompt-extraction-visio.md'),
    glossaire: () =>
      cerveau
        ? lireSiPresent(path.join(cerveau, 'brain', 'outils', 'glossaire-visio.txt'))
        : Promise.resolve(''),
  };
}

// Au-delà, l'agent perd des chiffres en route : on extrait d'abord bloc par bloc, puis on rédige.
export const SEUIL_DEUX_TEMPS = 30_000;
export const TAILLE_BLOC = 15_000;

// Découpe aux changements de réplique, jamais au milieu d'une ligne.
export function decouperEnBlocs(transcript: string, taille = TAILLE_BLOC): string[] {
  const blocs: string[] = [];
  let courant: string[] = [];
  let longueur = 0;
  for (const ligne of transcript.split('\n')) {
    if (courant.length > 0 && longueur + ligne.length + 1 > taille) {
      blocs.push(courant.join('\n'));
      courant = [];
      longueur = 0;
    }
    courant.push(ligne);
    longueur += ligne.length + 1;
  }
  if (courant.length > 0) blocs.push(courant.join('\n'));
  return blocs;
}

const dateParis = (d: Date) =>
  new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
const heureParis = (d: Date) =>
  new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(d)
    .replace(':', ' h ');

// Données de la réunion, telles que le prompt les attend ; une donnée absente est dite absente.
export function metadonnees(
  v: Pick<VisioAResumer, 'titre' | 'debut' | 'fin' | 'participants' | 'interlocuteurs'>,
) {
  const debut = v.debut ? new Date(v.debut) : null;
  const fin = v.fin ? new Date(v.fin) : null;
  return {
    TITRE: v.titre,
    DATE: debut ? dateParis(debut) : 'non disponible',
    HEURES: debut
      ? `${heureParis(debut)} – ${fin ? heureParis(fin) : 'fin non disponible'} (fuseau Europe/Paris)`
      : 'non disponibles',
    PARTICIPANTS: v.participants?.length ? v.participants.join(', ') : 'non disponibles',
    INTERLOCUTEURS: v.interlocuteurs?.length
      ? v.interlocuteurs
          .map((i) => (i.entreprise ? `${i.nom} (${i.entreprise})` : i.nom))
          .join(', ')
      : 'non identifié',
  };
}

// Remplacement en un seul passage : un « {{X}} » écrit dans le transcript n'est jamais réinterprété.
export function remplir(modele: string, valeurs: Record<string, string>): string {
  return modele.replace(/\{\{(\w+)\}\}/g, (m, cle: string) => valeurs[cle] ?? m);
}

const NATURE_TRANSCRIPTION = 'Transcription brute';
const NATURE_EXTRAITS =
  "Notes d'extraction, bloc par bloc et dans l'ordre de la réunion (la transcription a été trop longue pour un seul passage : ces notes en sont la matière complète ; rédige le compte rendu à partir d'elles, en respectant toutes les règles)";

export const promptResume = (
  modele: string,
  v: Pick<VisioAResumer, 'titre' | 'debut' | 'fin' | 'participants' | 'interlocuteurs'>,
  texte: string,
  glossaire: string,
  nature = NATURE_TRANSCRIPTION,
): string =>
  remplir(modele, {
    ...metadonnees(v),
    GLOSSAIRE: glossaire.trim() || 'non fourni',
    NATURE_TEXTE: nature,
    TRANSCRIPT: texte,
  });

// Une rédaction : un seul appel, ou extraction par blocs puis rédaction. Null si Claude échoue.
export async function rediger(
  v: VisioAResumer,
  claude: string,
  lancer: LancerTexte,
  ressources: Ressources,
): Promise<string | null> {
  const [modele, glossaire] = await Promise.all([ressources.synthese(), ressources.glossaire()]);
  const appeler = async (prompt: string) => {
    const { code, stdout } = await lancer(claude, ['-p', prompt]);
    return code === 0 ? stdout.trim() : '';
  };
  if (v.transcript.length <= SEUIL_DEUX_TEMPS) {
    return (await appeler(promptResume(modele, v, v.transcript, glossaire))) || null;
  }
  const modeleExtraction = await ressources.extraction();
  const blocs = decouperEnBlocs(v.transcript);
  const notes: string[] = [];
  for (const [i, bloc] of blocs.entries()) {
    const note = await appeler(
      remplir(modeleExtraction, {
        ...metadonnees(v),
        RANG: String(i + 1),
        TOTAL: String(blocs.length),
        GLOSSAIRE: glossaire.trim() || 'non fourni',
        TRANSCRIPT: bloc,
      }),
    );
    if (!note) return null;
    notes.push(`## Bloc ${i + 1} sur ${blocs.length}\n${note}`);
  }
  return (
    (await appeler(promptResume(modele, v, notes.join('\n\n'), glossaire, NATURE_EXTRAITS))) || null
  );
}

// Un passage : résume les visios transcrites que l'OS signale, une à une.
export async function passerResumes(
  api: Api,
  claude: string,
  lancer: LancerTexte,
  maintenant: () => number = Date.now,
  ressources: Ressources = ressourcesDuPoste(),
): Promise<number> {
  const attente = await api<VisioAResumer[]>('/api/runner/resumes');
  let faits = 0;
  for (const v of attente) {
    const essaye = dernierEssai.get(v.id);
    if (essaye !== undefined && maintenant() - essaye < REESSAI_MS) continue;
    dernierEssai.set(v.id, maintenant());
    const resume = await rediger(v, claude, lancer, ressources).catch((e: unknown) => {
      console.error('Synthèse de visio impossible :', e);
      return null;
    });
    if (!resume) continue;
    await api(`/api/runner/resumes/${v.id}`, { instance: v.instance, resume });
    dernierEssai.delete(v.id);
    faits++;
  }
  return faits;
}
