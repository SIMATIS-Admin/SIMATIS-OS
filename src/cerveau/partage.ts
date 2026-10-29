import { createHash } from 'node:crypto';
import { carteDepuisNotes, type Carte } from './carte.js';
import { ErreurCerveau } from './fichiers.js';

// Espace partagé AlpesIA × Simatis (un dossier kDrive commun à Christophe et Marc). Il se lit et
// s'écrit par le serveur MCP « partage » déjà installé sur le poste : c'est lui qui porte les
// garde-fous (un message déposé ne se modifie plus, un document se publie dans son propre dossier) et
// le jeton kDrive, qui ne passe jamais par l'OS.

export type AppelerPartage = (outil: string, args: Record<string, unknown>) => Promise<string>;

// Qui publie où : copie de la règle du serveur, pour griser l'édition. Le serveur refuse de toute façon.
const DOSSIERS: Record<string, string> = { reference: 'christophe', prospection: 'marc' };
const MAX_NOTES = 200;

const empreinteDe = (contenu: string) => createHash('sha256').update(contenu).digest('hex');

const echec = (e: unknown) => new ErreurCerveau(e instanceof Error ? e.message : String(e));

// Pourquoi ce fichier ne se modifie pas (null s'il se modifie).
export function raisonLectureSeule(chemin: string, auteur: string): string | null {
  const [haut, ...reste] = chemin.split('/');
  if (!reste.length) return 'Ce fichier est tenu par le curateur de l’espace.';
  if (haut === 'echanges')
    return 'Un message déposé ne se modifie plus : répondez-y par un nouveau message.';
  if (haut === 'archives') return 'Les archives ne se modifient pas.';
  const proprietaire = DOSSIERS[haut ?? ''];
  if (!proprietaire) return 'Dossier inconnu de l’espace partagé.';
  if (proprietaire !== auteur)
    return `Ce dossier appartient à ${proprietaire[0]?.toUpperCase()}${proprietaire.slice(1)} : déposez-lui un message pour demander une correction.`;
  return null;
}

export const dossierPropre = (auteur: string) =>
  Object.entries(DOSSIERS).find(([, o]) => o === auteur)?.[0] ?? null;

export async function lirePartage(appeler: AppelerPartage, chemin: string, auteur: string) {
  const texte = await appeler('lire_partage', { chemin }).catch((e: unknown) => {
    throw echec(e);
  });
  if (/\nFichier non textuel/.test(texte) || texte.startsWith('[') === false)
    throw new ErreurCerveau('Ce fichier n’est pas une note texte : ouvrez-le dans le kDrive.');
  const contenu = texte.replace(/^\[[^\n]*\]\n\n?/, '');
  const tronque = /\n\n\[tronqué : \d+ caractères au total\]$/.test(contenu);
  return {
    contenu,
    empreinte: empreinteDe(contenu),
    lectureSeule: tronque
      ? 'Note trop longue pour l’éditeur : modifiez-la dans le kDrive.'
      : raisonLectureSeule(chemin, auteur),
  };
}

// Publie (crée ou remplace) un document de son propre dossier. Le contenu a pu changer depuis son
// ouverture (l'autre, kDrive) : on le relit et on refuse d'écraser.
export async function ecrirePartage(
  appeler: AppelerPartage,
  chemin: string,
  contenu: string,
  empreinte: string,
  auteur: string,
) {
  const raison = raisonLectureSeule(chemin, auteur);
  if (raison) throw new ErreurCerveau(raison);
  const actuel = await lirePartage(appeler, chemin, auteur);
  if (actuel.empreinte !== empreinte)
    throw new ErreurCerveau(
      'Le document a été modifié ailleurs depuis son ouverture. Rechargez-le avant de l’enregistrer.',
      true,
    );
  await appeler('publier_document', { chemin, contenu }).catch((e: unknown) => {
    throw echec(e);
  });
  return { empreinte: empreinteDe(contenu.replace(/\s*$/, '\n')) };
}

const slug = (titre: string) =>
  titre
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);

// Nouveau document dans le dossier de Marc ; ne remplace jamais un document existant.
export async function ajouterDocumentPartage(
  appeler: AppelerPartage,
  doc: { titre: string; texte: string },
  auteur: string,
  maintenant = new Date(),
) {
  const dossier = dossierPropre(auteur);
  if (!dossier) throw new ErreurCerveau('Cet espace n’a pas de dossier à votre nom.');
  const titre = doc.titre.trim().replace(/\s+/g, ' ');
  if (!titre) throw new ErreurCerveau('Donnez un titre au document.');
  const jour = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(maintenant);
  const base = `${dossier}/${jour}_${slug(titre) || 'document'}`;
  let chemin = `${base}.md`;
  for (
    let i = 2;
    await appeler('lire_partage', { chemin }).then(
      () => true,
      () => false,
    );
    i++
  )
    chemin = `${base}-${i}.md`;
  await appeler('publier_document', {
    chemin,
    contenu: `# ${titre}\n\n${doc.texte.trim()}\n`,
  }).catch((e: unknown) => {
    throw echec(e);
  });
  return { chemin };
}

export type Message = {
  genre: 'question' | 'reponse' | 'info';
  sujet: string;
  corps: string;
  enReponseA?: string | undefined;
};

export async function deposerMessage(appeler: AppelerPartage, m: Message) {
  const sortie = await appeler('deposer_message', {
    type: m.genre,
    sujet: m.sujet,
    corps: m.corps,
    ...(m.enReponseA ? { en_reponse_a: m.enReponseA } : {}),
  }).catch((e: unknown) => {
    throw echec(e);
  });
  const chemin = (JSON.parse(sortie) as { chemin?: string }).chemin;
  return { ...(chemin ? { chemin } : {}) };
}

// Chemins listés par lister_partage (« - chemin · taille · date · auteur »).
export async function listerPartage(appeler: AppelerPartage) {
  const texte = await appeler('lister_partage', {});
  return texte
    .split('\n')
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2).split(' · ')[0] as string);
}

// Carte de l'espace partagé : un nœud par note Markdown, les liens se lisent dans les textes.
export async function cartePartage(appeler: AppelerPartage, auteur: string): Promise<Carte> {
  const fichiers = await listerPartage(appeler);
  const md = fichiers.filter((f) => f.endsWith('.md'));
  const lus: { id: string; texte: string }[] = [];
  const file = [...md.slice(0, MAX_NOTES)];
  // Quatre lectures à la fois : l'API kDrive limite le débit.
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let id = file.shift(); id; id = file.shift()) {
        const note = await lirePartage(appeler, id, auteur).catch(() => null);
        if (note) lus.push({ id, texte: note.contenu });
      }
    }),
  );
  lus.sort((a, b) => a.id.localeCompare(b.id));
  const carte = carteDepuisNotes(lus, { autresFichiers: fichiers.length - md.length });
  return { ...carte, tronquee: md.length > MAX_NOTES };
}
