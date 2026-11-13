import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

// Les supports sont des dossiers de fichiers texte, hors du dépôt (confidentiel) :
// SUPPORTS_DIR donne leur dossier. Ce module ne fait que les lire, avec des noms strictement validés.
export class SupportIntrouvable extends Error {}

const DECK = /^[a-z0-9-]+$/;
const MODULE = /^[a-z0-9-]+\.md$/;
// Support en HTML libre : une slide par fichier, une feuille de style commune.
const SLIDE = /^slides\/[a-z0-9-]+\.html$/;
const FEUILLE = /^[a-z0-9-]+\.css$/;
const CLIENT = /^clients\/[a-z0-9-]+\.json$/;
const IMAGE = /^img\/[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpe?g|gif|webp|svg)$/i;

const TYPES: Record<string, string> = {
  '.md': 'text/plain; charset=utf-8',
  // Le HTML et le CSS d'un support se lisent comme du texte : le lecteur les affiche dans un cadre
  // isolé, jamais comme une page de l'OS.
  '.html': 'text/plain; charset=utf-8',
  '.css': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  // Une image SVG ne s'exécute pas : servie avec son type, jamais comme une page.
  '.svg': 'image/svg+xml',
};

export const dossierSupports = (): string => {
  const dossier = process.env.SUPPORTS_DIR?.trim();
  if (!dossier) throw new SupportIntrouvable("Aucun dossier de supports n'est configuré.");
  return dossier;
};

export type ResumeDeck = { id: string; titre: string; soustitre: string };

const lireJson = async (chemin: string): Promise<unknown> =>
  JSON.parse(await readFile(chemin, 'utf8')) as unknown;

export async function listerDecks(): Promise<ResumeDeck[]> {
  const racine = dossierSupports();
  let entrees: string[];
  try {
    entrees = await readdir(racine);
  } catch {
    throw new SupportIntrouvable("Le dossier de supports n'existe pas.");
  }
  const decks: ResumeDeck[] = [];
  for (const id of entrees.sort()) {
    if (!DECK.test(id)) continue;
    try {
      const m = (await lireJson(path.join(racine, id, 'manifest.json'))) as {
        titre?: unknown;
        soustitre?: unknown;
      };
      decks.push({
        id,
        titre: typeof m.titre === 'string' ? m.titre : id,
        soustitre: typeof m.soustitre === 'string' ? m.soustitre : '',
      });
    } catch {
      // Un dossier sans manifest lisible n'est pas un support.
    }
  }
  return decks;
}

// Un fichier du deck : le manifest, un module que le manifest déclare, le profil d'un client ou
// une image. Tout autre nom, dont toute traversée de chemin, est refusé avant d'ouvrir un fichier.
export async function lireFichierDeck(
  deck: string,
  relatif: string,
): Promise<{ contenu: Buffer; type: string; modifie: Date }> {
  const racine = dossierSupports();
  if (!DECK.test(deck)) throw new SupportIntrouvable('Support introuvable');
  const declare = MODULE.test(relatif) || SLIDE.test(relatif) || FEUILLE.test(relatif);
  if (relatif !== 'manifest.json' && !declare && !CLIENT.test(relatif) && !IMAGE.test(relatif))
    throw new SupportIntrouvable('Fichier introuvable');
  const dossier = path.join(racine, deck);
  try {
    if (declare) {
      // Le manifest est la liste blanche : modules markdown, slides HTML par partie, feuille de style.
      const manifest = (await lireJson(path.join(dossier, 'manifest.json'))) as {
        modules?: unknown;
        css?: unknown;
        parties?: unknown;
      };
      const permis = new Set<unknown>(Array.isArray(manifest.modules) ? manifest.modules : []);
      if (typeof manifest.css === 'string') permis.add(manifest.css);
      if (Array.isArray(manifest.parties))
        for (const partie of manifest.parties as { slides?: unknown }[])
          if (Array.isArray(partie?.slides)) for (const f of partie.slides) permis.add(f);
      if (!permis.has(relatif)) throw new SupportIntrouvable('Fichier absent du manifest');
    }
    const chemin = path.join(dossier, relatif);
    const [contenu, infos] = await Promise.all([readFile(chemin), stat(chemin)]);
    return {
      contenu,
      type: TYPES[path.extname(relatif).toLowerCase()] ?? 'application/octet-stream',
      modifie: infos.mtime,
    };
  } catch (e) {
    if (e instanceof SupportIntrouvable) throw e;
    throw new SupportIntrouvable('Fichier introuvable');
  }
}
