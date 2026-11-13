// Parseur des supports : un manifest et des modules markdown deviennent des slides.
// Fonctions pures, sans lecture de fichier ni de navigateur : on les teste en premier.
export type Manifest = {
  titre: string;
  soustitre: string;
  generique: Record<string, string>;
  modules: string[];
  // Habillage du support (restitution d'un diagnostic, formation) : logo du dossier img/ et deux
  // couleurs. Absents, le lecteur garde la charte de l'OS.
  logo: string | null;
  couleur: string | null;
  accent: string | null;
  // « html » : une slide par fichier HTML libre (dossier slides/) et une feuille de style commune,
  // affichées telles quelles sur un canevas de 1920 × 1080 ; sinon, des modules markdown.
  format: 'md' | 'html';
  css: string | null;
  polices: string[];
  parties: PartieHtml[];
};
export type PartieHtml = { titre: string; duree: number | null; slides: string[] };

export const TYPES_SLIDE = ['titre', 'concept', 'demo', 'atelier', 'recap', 'piege'] as const;
export type TypeSlide = (typeof TYPES_SLIDE)[number];

export type SlideCours = {
  titre: string;
  type: TypeSlide;
  livrable: string | null;
  // Une entrée par colonne ; une seule pour une slide sans colonnes.
  colonnes: string[];
  notes: string;
  // Slide en HTML libre : le contenu de la <section>, à afficher dans un cadre isolé.
  html: string | null;
};

export type Module = {
  titre: string;
  duree: number | null;
  objectif: string;
  slides: SlideCours[];
};

const SLIDE_HTML = /^slides\/[a-z0-9-]+\.html$/;

export function lireManifest(brut: unknown): Manifest {
  const m = (brut ?? {}) as Record<string, unknown>;
  const texte = (v: unknown) => (typeof v === 'string' ? v : '');
  const generique: Record<string, string> = {};
  if (m.generique && typeof m.generique === 'object')
    for (const [cle, valeur] of Object.entries(m.generique as Record<string, unknown>))
      if (typeof valeur === 'string') generique[cle] = valeur;
  const couleur = (v: unknown) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : null);
  const logo = texte(m.logo);
  const parties: PartieHtml[] = Array.isArray(m.parties)
    ? (m.parties as Record<string, unknown>[]).flatMap((p) => {
        const slides = Array.isArray(p?.slides)
          ? p.slides.filter((f): f is string => typeof f === 'string' && SLIDE_HTML.test(f))
          : [];
        const duree = typeof p?.duree === 'number' && p.duree > 0 ? p.duree : null;
        return slides.length > 0 ? [{ titre: texte(p?.titre), duree, slides }] : [];
      })
    : [];
  return {
    format: m.format === 'html' ? 'html' : 'md',
    css: /^[a-z0-9-]+\.css$/.test(texte(m.css)) ? texte(m.css) : null,
    polices: Array.isArray(m.polices)
      ? m.polices.filter(
          (u): u is string =>
            typeof u === 'string' && /^https:\/\/fonts\.googleapis\.com\/css2\?/.test(u),
        )
      : [],
    parties,
    logo: /^img\/[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpe?g|webp|svg)$/i.test(logo) ? logo : null,
    couleur: couleur(m.couleur),
    accent: couleur(m.accent),
    titre: texte(m.titre) || 'Support',
    soustitre: texte(m.soustitre),
    generique,
    modules: Array.isArray(m.modules)
      ? m.modules.filter((x): x is string => typeof x === 'string')
      : [],
  };
}

// {{client.prenom}} : la variable du profil client chargé, sinon la valeur générique du manifest,
// sinon le texte tel quel (une variable oubliée se voit à l'écran au lieu de disparaître).
export function remplacerVariables(
  texte: string,
  client: Record<string, string>,
  generique: Record<string, string>,
): string {
  return texte.replace(/\{\{\s*client\.([\w-]+)\s*\}\}/g, (brut, nom: string) => {
    const v = client[nom] ?? generique[nom];
    return v ?? brut;
  });
}

const CLE_VALEUR = /^([a-z][a-z0-9_-]*):[ \t]*(.*)$/i;

const attributs = (lignes: string[]): Record<string, string> => {
  const attrs: Record<string, string> = {};
  for (const ligne of lignes) {
    const m = CLE_VALEUR.exec(ligne);
    if (m) attrs[m[1]!.toLowerCase()] = m[2]!.trim();
  }
  return attrs;
};

const typeDe = (v: string | undefined): TypeSlide =>
  (TYPES_SLIDE as readonly string[]).includes(v ?? '') ? (v as TypeSlide) : 'concept';

function lireSlide(bloc: string): SlideCours | null {
  const lignes = bloc.split('\n');
  while (lignes.length > 0 && lignes[0]!.trim() === '') lignes.shift();
  const entete = /^##[ \t]+(.+?)[ \t]*$/.exec(lignes[0] ?? '');
  if (!entete) return null;
  lignes.shift();
  // Les attributs (type:, livrable:, colonnes:) suivent directement le titre, jusqu'à une ligne vide.
  const brutsAttrs: string[] = [];
  while (lignes.length > 0 && CLE_VALEUR.test(lignes[0]!)) brutsAttrs.push(lignes.shift()!);
  const attrs = attributs(brutsAttrs);
  let corps = lignes.join('\n');
  let notes = '';
  corps = corps.replace(
    /^:::[ \t]*notes[ \t]*\n([\s\S]*?)^:::[ \t]*$/m,
    (_tout, contenu: string) => {
      notes = contenu.trim();
      return '';
    },
  );
  const colonnes = corps
    .split(/^:::[ \t]*colonne[ \t]*$/m)
    .map((c) => c.trim())
    .filter((c, i) => i === 0 || c !== '');
  return {
    titre: entete[1]!,
    type: typeDe(attrs.type),
    livrable: attrs.livrable || null,
    colonnes: colonnes.length > 0 ? colonnes : [''],
    notes,
    html: null,
  };
}

export function lireModule(source: string): Module {
  let reste = source.replace(/\r\n?/g, '\n');
  let meta: Record<string, string> = {};
  const entete = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(reste);
  if (entete) {
    meta = attributs(entete[1]!.split('\n'));
    reste = reste.slice(entete[0].length);
  }
  const slides = reste
    .split(/^---[ \t]*$/m)
    .map(lireSlide)
    .filter((s): s is SlideCours => s !== null);
  const duree = Number.parseInt(meta.duree ?? '', 10);
  return {
    titre: meta.titre ?? '',
    duree: Number.isFinite(duree) && duree > 0 ? duree : null,
    objectif: meta.objectif ?? '',
    slides,
  };
}
