import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Un deck Slides de claude.ai (project/deck.json, project/slides/<id>.html, project/deck.css, images)
// devient un support « format html » du lecteur : mêmes fichiers, mêmes slides, rien n'est
// réécrit. Seuls changent les chemins d'images (ramenés dans img/) et l'ordre des slides, regroupées
// par partie d'après les sections du deck.
export type ResultatImport = { slides: number; images: number; manquantes: string[] };

const ID_SLIDE = /^[A-Za-z0-9_-]{1,64}$/;
const REF_IMAGE = /(\/_blob\/[0-9a-f]{32}|project\/ds\/[^"')\s]+)/g;
const POLICE_GOOGLE = /^https:\/\/fonts\.googleapis\.com\/css2\?/;

const nomFichier = (id: string) =>
  id
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');

const existe = (chemin: string) =>
  readFile(chemin).then(
    () => true,
    () => false,
  );

// Les images lues par Artifact action read : un fichier publié garde son chemin sous le dossier de
// travail, une ressource (/_blob/<id>) s'enregistre à la racine sous son identifiant.
async function trouverImage(source: string, ref: string): Promise<string | null> {
  if (ref.startsWith('/_blob/')) {
    const id = ref.slice('/_blob/'.length);
    const fichier = (await readdir(source)).find((f) => f.startsWith(`${id}.`) || f === id);
    return fichier ? path.join(source, fichier) : null;
  }
  const chemin = path.join(source, ref);
  if (!chemin.startsWith(source + path.sep)) return null;
  return (await existe(chemin)) ? chemin : null;
}

type Section = { description?: unknown; start?: unknown };

export async function convertirDeck(source: string, destination: string): Promise<ResultatImport> {
  const deck = JSON.parse(await readFile(path.join(source, 'project', 'deck.json'), 'utf8')) as {
    title?: unknown;
    order?: unknown;
    sections?: Record<string, Section>;
    faces?: Record<string, { href?: unknown }>;
  };
  const ordre = Array.isArray(deck.order)
    ? deck.order.filter((i): i is string => typeof i === 'string' && ID_SLIDE.test(i))
    : [];
  if (ordre.length === 0) throw new Error('Deck vide : aucune slide dans project/deck.json');

  const temporaire = `${destination}.import-${process.pid}`;
  await rm(temporaire, { recursive: true, force: true });
  await mkdir(path.join(temporaire, 'slides'), { recursive: true });
  await mkdir(path.join(temporaire, 'img'), { recursive: true });

  const images = new Map<string, string>();
  const manquantes: string[] = [];
  const noms = new Set<string>();
  const ramener = async (ref: string): Promise<string> => {
    const connu = images.get(ref);
    if (connu) return connu;
    const origine = await trouverImage(source, ref);
    if (!origine) {
      manquantes.push(ref);
      images.set(ref, ref);
      return ref;
    }
    const ext = path.extname(origine).toLowerCase() || '.png';
    const base = nomFichier(path.basename(origine, path.extname(origine))) || 'image';
    let nom = `${base}${ext}`;
    for (let n = 2; noms.has(nom); n++) nom = `${base}-${n}${ext}`;
    noms.add(nom);
    await copyFile(origine, path.join(temporaire, 'img', nom));
    const nouveau = `img/${nom}`;
    images.set(ref, nouveau);
    return nouveau;
  };
  const reecrire = async (texte: string) => {
    let sortie = texte;
    for (const ref of new Set([...texte.matchAll(REF_IMAGE)].map((m) => m[1]!))) {
      const nouveau = await ramener(ref);
      sortie = sortie.split(ref).join(nouveau);
    }
    return sortie;
  };

  // Feuille de style commune : absente d'un deck dont les styles sont dans les slides.
  let aUneFeuille = true;
  try {
    const css = await reecrire(await readFile(path.join(source, 'project', 'deck.css'), 'utf8'));
    await writeFile(path.join(temporaire, 'deck.css'), css);
  } catch {
    aUneFeuille = false;
  }

  const fichiers = new Map<string, string>();
  const pris = new Set<string>();
  for (const id of ordre) {
    let nom = nomFichier(id) || 'slide';
    for (let n = 2; pris.has(nom); n++) nom = `${nomFichier(id) || 'slide'}-${n}`;
    pris.add(nom);
    const html = await reecrire(
      await readFile(path.join(source, 'project', 'slides', `${id}.html`), 'utf8'),
    );
    await writeFile(path.join(temporaire, 'slides', `${nom}.html`), html);
    fichiers.set(id, `slides/${nom}.html`);
  }

  // Une partie par section du deck : de sa première slide à la veille de la section suivante.
  const sections = Object.values(deck.sections ?? {}).filter(
    (s): s is { description: string; start: string } =>
      typeof s.description === 'string' && typeof s.start === 'string' && ordre.includes(s.start),
  );
  sections.sort((a, b) => ordre.indexOf(a.start) - ordre.indexOf(b.start));
  const parties = sections.length
    ? sections.map((s, i) => {
        const de = ordre.indexOf(s.start);
        const a = i + 1 < sections.length ? ordre.indexOf(sections[i + 1]!.start) : ordre.length;
        const duree = /\((\d+)\s*min\)/.exec(s.description);
        const titre = s.description
          .replace(/\(.*?\)/g, '')
          .split(/[.:]/)[0]!
          .trim();
        return {
          titre: titre || `Partie ${i + 1}`,
          duree: duree ? Number(duree[1]) : null,
          slides: ordre.slice(de, a).map((id) => fichiers.get(id)!),
        };
      })
    : [{ titre: 'Présentation', duree: null, slides: ordre.map((id) => fichiers.get(id)!) }];
  // Slides avant la première section : rattachées à la première partie.
  const avant = ordre.slice(0, sections.length ? ordre.indexOf(sections[0]!.start) : 0);
  if (avant.length) parties[0]!.slides.unshift(...avant.map((id) => fichiers.get(id)!));

  const polices = Object.values(deck.faces ?? {})
    .map((f) => f.href)
    .filter((h): h is string => typeof h === 'string' && POLICE_GOOGLE.test(h));
  const manifest = {
    titre: typeof deck.title === 'string' && deck.title ? deck.title : 'Présentation',
    soustitre: '',
    format: 'html',
    ...(aUneFeuille ? { css: 'deck.css' } : {}),
    polices,
    generique: {},
    parties,
  };
  await writeFile(path.join(temporaire, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // Remplacement d'un bloc : l'ancien support disparaît seulement quand le nouveau est complet.
  await rm(destination, { recursive: true, force: true });
  await rename(temporaire, destination);
  return { slides: ordre.length, images: images.size - manquantes.length, manquantes };
}
