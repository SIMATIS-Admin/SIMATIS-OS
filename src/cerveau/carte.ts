import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export type Noeud = {
  // Chemin relatif de la note dans le second cerveau (jamais son contenu).
  id: string;
  titre: string;
  categorie: string;
  statut: string | null;
  // Sujet auquel une idée se rapporte (« os » : le développement de l'OS), lu dans l'en-tête.
  concerne?: string | null | undefined;
};
export type Lien = { de: string; vers: string };
export type Carte = {
  noeuds: Noeud[];
  liens: Lien[];
  // Fichiers qui ne sont pas des notes Markdown (pièces jointes, présentations) : comptés seulement.
  autresFichiers: number;
  tronquee: boolean;
};

const MAX_NOTES = 5000;

async function parcourir(dossier: string, rel = ''): Promise<string[]> {
  const out: string[] = [];
  const entrees = await readdir(path.join(dossier, rel), { withFileTypes: true });
  for (const e of entrees) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const chemin = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await parcourir(dossier, chemin)));
    else if (e.isFile()) out.push(chemin);
  }
  return out.sort();
}

// Catégorie = type de note, lu dans l'arborescence : brain/<domaine>/… donne le domaine, les autres
// dossiers de premier niveau (skills, sources, modeles) se représentent eux-mêmes.
const categorieDe = (id: string) => {
  const parties = id.split('/');
  if (parties.length === 1) return 'racine';
  return parties[0] === 'brain' && parties.length > 2
    ? (parties[1] as string)
    : (parties[0] as string);
};

const sansCode = (texte: string) => texte.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');

const champDe = (texte: string, champ: string) => {
  const entete = /^---\n([\s\S]*?)\n---/.exec(texte)?.[1];
  return entete ? (new RegExp(`^${champ}:\\s*(\\S+)`, 'm').exec(entete)?.[1] ?? null) : null;
};
const statutDe = (texte: string) => champDe(texte, 'statut');

// Titre : premier titre « # », sinon le « sujet » de l'en-tête (messages de l'espace partagé), sinon le nom.
const titreDe = (texte: string, id: string) => {
  const sans = texte.replace(/^---\n[\s\S]*?\n---\n?/, '');
  const sujet = /^sujet:\s*(.+)$/m
    .exec(/^---\n([\s\S]*?)\n---/.exec(texte)?.[1] ?? '')?.[1]
    ?.trim();
  return (
    /^#\s+(.+)$/m.exec(sans)?.[1]?.trim() ??
    (sujet ? sujet.replace(/^"(.*)"$/, '$1') : path.basename(id, '.md'))
  );
};

// Carte à partir de notes déjà lues : le dossier du Drive et l'espace partagé s'y ramènent.
export function carteDepuisNotes(
  toutes: { id: string; texte: string }[],
  options: { max?: number; autresFichiers?: number } = {},
): Carte {
  const max = options.max ?? MAX_NOTES;
  const notes = toutes.slice(0, max);
  const ids = new Set(notes.map((n) => n.id));
  // Nom court → notes, comme Obsidian résout [[nom]] sans le chemin.
  const parNom = new Map<string, string[]>();
  for (const { id } of notes) {
    const nom = path.basename(id, '.md').toLowerCase();
    parNom.set(nom, [...(parNom.get(nom) ?? []), id]);
  }

  const noeuds: Noeud[] = [];
  const liens = new Map<string, Lien>();
  const ajouter = (de: string, vers: string | undefined) => {
    if (vers && vers !== de && ids.has(vers)) liens.set(`${de}\0${vers}`, { de, vers });
  };

  for (const { id, texte } of notes) {
    noeuds.push({
      id,
      titre: titreDe(texte, id),
      categorie: categorieDe(id),
      statut: statutDe(texte),
      concerne: champDe(texte, 'concerne'),
    });
    const corps = sansCode(texte);
    for (const m of corps.matchAll(/\[\[([^\]|#]+)[^\]]*\]\]/g)) {
      const cible = (m[1] as string).trim();
      ajouter(
        id,
        ids.has(cible)
          ? cible
          : ids.has(`${cible}.md`)
            ? `${cible}.md`
            : parNom.get(cible.toLowerCase())?.[0],
      );
    }
    for (const m of corps.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const cible = (m[1] as string).split('#')[0] as string;
      if (!cible.endsWith('.md') || /^[a-z]+:/i.test(cible)) continue;
      const resolu = path.posix.normalize(
        path.posix.join(path.posix.dirname(id), decodeURI(cible)),
      );
      ajouter(id, resolu);
    }
  }

  return {
    noeuds,
    liens: [...liens.values()],
    autresFichiers: options.autresFichiers ?? 0,
    tronquee: toutes.length > notes.length,
  };
}

export async function construireCarte(
  dossier: string,
  options: { max?: number } = {},
): Promise<Carte> {
  const fichiers = await parcourir(dossier);
  const toutes = fichiers.filter((f) => f.endsWith('.md')).slice(0, (options.max ?? MAX_NOTES) + 1);
  const notes = await Promise.all(
    toutes.map(async (id) => ({ id, texte: await readFile(path.join(dossier, id), 'utf8') })),
  );
  return carteDepuisNotes(notes, {
    ...options,
    autresFichiers: fichiers.length - fichiers.filter((f) => f.endsWith('.md')).length,
  });
}
