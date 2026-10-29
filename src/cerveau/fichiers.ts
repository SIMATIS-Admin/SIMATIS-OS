import { createHash } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Lecture et écriture des notes du second cerveau, sur le poste de Marc (jamais dans le conteneur).
// Le dossier du Drive reste la référence : on y écrit directement, et chaque modification est notée
// en tête de log.md comme l'exigent les règles du dossier.

export class ErreurCerveau extends Error {
  constructor(
    message: string,
    readonly conflit = false,
  ) {
    super(message);
  }
}

const TAILLE_MAX = 500_000;

// Seules les notes Markdown se lisent et s'écrivent ; rien de caché (.obsidian), rien hors du dossier.
export function resoudre(dossier: string, chemin: string): string {
  const parties = chemin.split('/');
  if (
    !chemin ||
    chemin.length > 300 ||
    chemin.includes('\0') ||
    chemin.includes('\\') ||
    path.posix.isAbsolute(chemin) ||
    !chemin.endsWith('.md') ||
    parties.some((p) => p === '' || p === '..' || p.startsWith('.'))
  )
    throw new ErreurCerveau('Chemin de note invalide.');
  const absolu = path.join(dossier, ...parties);
  if (!absolu.startsWith(path.join(dossier, path.sep)))
    throw new ErreurCerveau('Chemin de note invalide.');
  return absolu;
}

const empreinteDe = (contenu: string) => createHash('sha256').update(contenu).digest('hex');

const lireTexte = (absolu: string) =>
  readFile(absolu, 'utf8').catch(() => {
    throw new ErreurCerveau('Note introuvable dans le second cerveau.');
  });

export async function lireNote(dossier: string, chemin: string) {
  const contenu = await lireTexte(resoudre(dossier, chemin));
  return { contenu, empreinte: empreinteDe(contenu) };
}

const dateLongue = (d: Date) =>
  d.toLocaleDateString('fr-FR', {
    timeZone: 'Europe/Paris',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
const jourIso = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(d);

const TITRE_JOURNAL = '# Journal des changements\n\n';

// Entrée datée en tête du journal (règle du dossier : « noter chaque modification »).
async function noterAuJournal(dossier: string, texte: string, maintenant: Date) {
  const absolu = path.join(dossier, 'log.md');
  const actuel = await readFile(absolu, 'utf8').catch(() => TITRE_JOURNAL);
  const corps = actuel.startsWith(TITRE_JOURNAL) ? actuel.slice(TITRE_JOURNAL.length) : actuel;
  await writeFile(
    absolu,
    `${TITRE_JOURNAL}- ${dateLongue(maintenant)} (depuis l'OS) : ${texte}\n\n${corps}`,
  );
}

const titreDe = (contenu: string, chemin: string) =>
  /^#\s+(.+)$/m.exec(contenu)?.[1]?.trim() ?? path.basename(chemin, '.md');

export async function ecrireNote(
  dossier: string,
  chemin: string,
  contenu: string,
  empreinte: string,
  maintenant = new Date(),
) {
  const absolu = resoudre(dossier, chemin);
  if (contenu.length > TAILLE_MAX) throw new ErreurCerveau('Note trop volumineuse.');
  const actuel = await lireTexte(absolu);
  // La note a pu changer depuis son ouverture (Obsidian, synchronisation du Drive) : on ne l'écrase pas.
  if (empreinteDe(actuel) !== empreinte)
    throw new ErreurCerveau(
      'La note a été modifiée ailleurs depuis son ouverture. Rechargez-la avant de l’enregistrer.',
      true,
    );
  await writeFile(absolu, contenu);
  if (chemin !== 'log.md')
    await noterAuJournal(
      dossier,
      `note [${titreDe(contenu, chemin)}](${chemin}) modifiée à la main par Marc dans l'OS.`,
      maintenant,
    );
  return { empreinte: empreinteDe(contenu) };
}

const slug = (titre: string) =>
  titre
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

const existe = (absolu: string) =>
  access(absolu).then(
    () => true,
    () => false,
  );

// Une idée tombe dans l'inbox du second cerveau, en brouillon : c'est le tri (skill « mémoriser »)
// qui l'intègre aux fiches.
export async function ajouterIdee(
  dossier: string,
  idee: { titre: string; texte: string },
  maintenant = new Date(),
) {
  const titre = idee.titre.trim().replace(/\s+/g, ' ');
  const texte = idee.texte.trim();
  if (!titre) throw new ErreurCerveau('Donnez un titre à l’idée.');
  if (texte.length > TAILLE_MAX) throw new ErreurCerveau('Note trop volumineuse.');
  const jour = jourIso(maintenant);
  const base = `${jour}_${slug(titre) || 'idee'}`;
  let nom = `${base}.md`;
  for (let i = 2; await existe(path.join(dossier, 'brain/inbox', nom)); i++)
    nom = `${base}-${i}.md`;
  const chemin = `brain/inbox/${nom}`;
  await writeFile(
    path.join(dossier, chemin),
    `---\ndate: ${jour}\nsource: idée ajoutée à la main depuis l'OS\nstatut: draft\n---\n\n# ${titre}\n\n${texte}\n`,
    { flag: 'wx' },
  );
  const index = path.join(dossier, 'brain/inbox/index.md');
  const actuel = await readFile(index, 'utf8').catch(() => '# Inbox\n');
  await writeFile(
    index,
    `${actuel.replace(/\n*$/, '\n')}- [${titre}](${nom}) — idée ajoutée à la main depuis l'OS le ${dateLongue(maintenant)}, statut draft.\n`,
  );
  await noterAuJournal(
    dossier,
    `idée [${titre}](${chemin}) déposée dans l'inbox par Marc depuis l'OS, draft.`,
    maintenant,
  );
  return { chemin };
}
