import readXlsxFile from 'read-excel-file/node';

export type Feuille = { nom: string; lignes: string[][] };

export class FichierIllisible extends Error {}

function decoder(contenu: Buffer): string {
  if (contenu[0] === 0xff && contenu[1] === 0xfe) return contenu.toString('utf16le').slice(1);
  if (contenu[0] === 0xef && contenu[1] === 0xbb && contenu[2] === 0xbf)
    return contenu.subarray(3).toString('utf8');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(contenu);
  } catch {
    // Excel on Windows exports CSV in Windows-1252.
    return new TextDecoder('windows-1252').decode(contenu);
  }
}

const SEPARATEURS = [';', ',', '\t', '|'] as const;

// The delimiter that splits the first lines into the same, highest number of cells.
export function detecterSeparateur(texte: string): string {
  const lignes = texte
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .slice(0, 12);
  let meilleur: string = ';';
  let meilleurScore = 0;
  for (const sep of SEPARATEURS) {
    const comptes = lignes.map((l) => decouperLigne(l, sep).length);
    const frequent = comptes.sort((a, b) => a - b)[Math.floor(comptes.length / 2)] ?? 1;
    const coherentes = comptes.filter((c) => c === frequent).length;
    const score = frequent > 1 ? (frequent - 1) * coherentes : 0;
    if (score > meilleurScore) {
      meilleur = sep;
      meilleurScore = score;
    }
  }
  return meilleur;
}

function decouperLigne(ligne: string, sep: string): string[] {
  const cellules: string[] = [];
  let cellule = '';
  let entreGuillemets = false;
  for (let i = 0; i < ligne.length; i++) {
    const c = ligne[i];
    if (entreGuillemets) {
      if (c === '"' && ligne[i + 1] === '"') {
        cellule += '"';
        i++;
      } else if (c === '"') entreGuillemets = false;
      else cellule += c;
    } else if (c === '"') entreGuillemets = true;
    else if (c === sep) {
      cellules.push(cellule);
      cellule = '';
    } else cellule += c;
  }
  cellules.push(cellule);
  return cellules;
}

// Quoted cells may hold line breaks: lines are cut outside quotes only.
function couperLignes(texte: string): string[] {
  const lignes: string[] = [];
  let courante = '';
  let entreGuillemets = false;
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (c === '"') entreGuillemets = !entreGuillemets;
    if (!entreGuillemets && (c === '\n' || c === '\r')) {
      if (c === '\r' && texte[i + 1] === '\n') i++;
      lignes.push(courante);
      courante = '';
    } else courante += c;
  }
  if (courante !== '') lignes.push(courante);
  return lignes;
}

const nettoyerLignes = (lignes: string[][]): string[][] =>
  lignes.map((l) => l.map((c) => c.trim())).filter((l) => l.some((c) => c !== ''));

export function lireTexte(texte: string): Feuille {
  const sep = detecterSeparateur(texte);
  return {
    nom: 'Texte collé',
    lignes: nettoyerLignes(couperLignes(texte).map((l) => decouperLigne(l, sep))),
  };
}

function enTexte(valeur: unknown): string {
  if (valeur === null || valeur === undefined) return '';
  if (valeur instanceof Date) return valeur.toISOString().slice(0, 10);
  return typeof valeur === 'string'
    ? valeur
    : typeof valeur === 'number' || typeof valeur === 'boolean'
      ? String(valeur)
      : '';
}

const estZip = (c: Buffer) => c[0] === 0x50 && c[1] === 0x4b;
const estAncienExcel = (c: Buffer) => c[0] === 0xd0 && c[1] === 0xcf && c[2] === 0x11;

export async function lireFichier(nom: string, contenu: Buffer): Promise<Feuille[]> {
  if (estAncienExcel(contenu))
    throw new FichierIllisible(
      'Ancien format Excel (.xls) : ouvrez le fichier dans Excel et enregistrez-le en .xlsx ou en CSV.',
    );
  if (estZip(contenu)) {
    let feuilles;
    try {
      feuilles = await readXlsxFile(contenu);
    } catch {
      throw new FichierIllisible("Ce fichier Excel n'a pas pu être lu.");
    }
    return feuilles
      .map((f) => ({ nom: f.sheet, lignes: nettoyerLignes(f.data.map((l) => l.map(enTexte))) }))
      .filter((f) => f.lignes.length > 0);
  }
  if (contenu.includes(0)) {
    throw new FichierIllisible(
      `Format de « ${nom} » non pris en charge : utilisez un fichier Excel (.xlsx), un CSV, ou collez le texte.`,
    );
  }
  const feuille = lireTexte(decoder(contenu));
  return feuille.lignes.length > 0 ? [{ ...feuille, nom: 'Fichier' }] : [];
}
