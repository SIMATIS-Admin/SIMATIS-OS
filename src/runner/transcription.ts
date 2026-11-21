import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Transcription locale des morceaux de visio : ffmpeg convertit, whisper.cpp transcrit. Tout reste
// sur le poste, aucune API payante.
export type OutilsTranscription = {
  ffmpeg: string;
  whisper: string;
  modele: string;
  // Noms propres soufflés à Whisper pour qu'il les orthographie correctement.
  amorce?: string;
};
export type Lanceur = (commande: string, args: string[]) => Promise<number>;
type Api = <T>(chemin: string, corps?: unknown) => Promise<T>;

type MorceauAttente = {
  instance: string;
  enregistrementId: string;
  piste: string;
  rang: number;
  mime: string;
  audio: string;
};

export const outilsDepuisEnv = (
  env: Record<string, string | undefined>,
): OutilsTranscription | null =>
  env.WHISPER_BIN && env.WHISPER_MODEL
    ? { ffmpeg: env.FFMPEG_BIN || 'ffmpeg', whisper: env.WHISPER_BIN, modele: env.WHISPER_MODEL }
    : null;

// Whisper note le silence et la musique entre crochets : ce n'est pas de la parole.
// Sur un silence ou un son dégradé, il invente aussi des génériques de sous-titrage : on les retire.
const SOUS_TITRAGE_PARASITE =
  /sous-titres réalisés par la communauté d['’]amara\.org|sous-titrage société radio-canada/gi;

export const nettoyerTranscription = (brut: string): string =>
  brut
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(SOUS_TITRAGE_PARASITE, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Une ligne du glossaire = « Terme — explication » ; seul le terme sert d'amorce. Whisper ne retient
// qu'environ 220 mots de contexte : on plafonne la longueur.
export function amorceDepuisGlossaire(glossaire: string): string {
  const termes = glossaire
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split(/\s+[—–-]\s+/)[0]?.trim() ?? '')
    .filter(Boolean);
  const amorce = termes.length ? `Noms propres : ${termes.join(', ')}.` : '';
  return amorce.slice(0, 600);
}

export async function transcrireMorceau(
  m: { mime: string; audio: Buffer },
  outils: OutilsTranscription,
  lancer: Lanceur,
): Promise<string> {
  const dossier = await mkdtemp(path.join(tmpdir(), 'simatis-visio-'));
  try {
    const entree = path.join(dossier, 'morceau');
    const wav = path.join(dossier, 'morceau.wav');
    const sortie = path.join(dossier, 'texte');
    await writeFile(entree, m.audio);
    const conversion = await lancer(outils.ffmpeg, [
      '-y',
      '-i',
      entree,
      '-ar',
      '16000',
      '-ac',
      '1',
      wav,
    ]);
    if (conversion !== 0) throw new Error('conversion audio impossible');
    const code = await lancer(outils.whisper, [
      '-m',
      outils.modele,
      '-f',
      wav,
      '-l',
      'fr',
      '-nt',
      ...(outils.amorce ? ['--prompt', outils.amorce] : []),
      '-otxt',
      '-of',
      sortie,
    ]);
    if (code !== 0) throw new Error('transcription impossible');
    return nettoyerTranscription(await readFile(`${sortie}.txt`, 'utf8'));
  } finally {
    await rm(dossier, { recursive: true, force: true });
  }
}

let signale = false;

// Un passage : lit les morceaux en attente, les transcrit un par un, rend le texte à l'OS. Un
// morceau illisible est rendu vide avec son erreur, pour que la session puisse se terminer.
export async function passerTranscriptions(
  api: Api,
  outils: OutilsTranscription | null,
  lancer: Lanceur,
): Promise<number> {
  if (!outils) {
    if (!signale) {
      signale = true;
      console.warn(
        'runner : transcription des visios non configurée (WHISPER_BIN et WHISPER_MODEL dans .env)',
      );
    }
    return 0;
  }
  const attente = await api<MorceauAttente[]>('/api/runner/transcriptions');
  for (const m of attente) {
    const chemin = `/api/runner/transcriptions/${m.enregistrementId}/${m.piste}/${m.rang}`;
    try {
      const texte = await transcrireMorceau(
        { mime: m.mime, audio: Buffer.from(m.audio, 'base64') },
        outils,
        lancer,
      );
      await api(chemin, { instance: m.instance, texte });
    } catch (e) {
      const erreur = e instanceof Error ? e.message : String(e);
      await api(chemin, { instance: m.instance, texte: '', erreur });
    }
  }
  return attente.length;
}
