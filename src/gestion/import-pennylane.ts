import type { Feuille } from '../base-vivante/lecture.js';
import { normaliserEntete } from '../base-vivante/colonnes.js';

// Export « Transactions bancaires » de Pennylane. Il ne porte ni identifiant de transaction ni solde :
// chaque ligne reçoit donc une clé calculée, stable d'un export à l'autre.
export const MAX_LIGNES_IMPORT = 5000;
const MAX_LIBELLE = 200;

export class ImportInvalide extends Error {}

export type LigneImport = {
  rang: number;
  cle: string;
  date: string;
  libelle: string;
  // Signé : négatif = sortie du compte, positif = entrée.
  montantCents: number;
  compte: string;
};

const ENTETES_REQUIS = [
  ['date', 'Date'],
  ['libelle', 'Libellé'],
  ['montant', 'Montant'],
] as const;

function dateIso(brut: string): string | null {
  const t = brut.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const fr = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  return fr ? `${fr[3]}-${fr[2]!.padStart(2, '0')}-${fr[1]!.padStart(2, '0')}` : null;
}

// « -23.99 », « -23,99 », « 1 234,50 » : le dernier séparateur est la décimale, l'autre sépare les milliers.
function montantCents(brut: string): number | null {
  let t = brut.replace(/\s/g, '');
  const virgule = t.lastIndexOf(',');
  const point = t.lastIndexOf('.');
  t =
    virgule >= 0 && point >= 0
      ? virgule > point
        ? t.replace(/\./g, '').replace(',', '.')
        : t.replace(/,/g, '')
      : t.replace(',', '.');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

export function lireTransactions(f: Feuille): { lignes: LigneImport[]; nonFinalisees: number } {
  const normalisees = f.lignes.slice(0, 5).map((l) => l.map(normaliserEntete));
  const entete = normalisees.findIndex((l) => ENTETES_REQUIS.every(([k]) => l.includes(k)));
  if (entete < 0) {
    const vues = normalisees[0] ?? [];
    const manquantes = ENTETES_REQUIS.filter(([k]) => !vues.includes(k)).map(([, nom]) => nom);
    throw new ImportInvalide(
      `Colonne obligatoire absente : ${manquantes.join(', ') || 'Date, Libellé, Montant'}. ` +
        'Exportez les « Transactions bancaires » depuis Pennylane.',
    );
  }
  const noms = normalisees[entete]!;
  const col = (nom: string) => noms.indexOf(nom);
  const iDate = col('date');
  const iLibelle = col('libelle');
  const iMontant = col('montant');
  const iCompte = noms.includes('compte bancaire') ? col('compte bancaire') : col('compte');
  const iEtat = col('etat');

  const donnees = f.lignes.slice(entete + 1);
  if (donnees.length > MAX_LIGNES_IMPORT)
    throw new ImportInvalide(`Fichier trop long : ${MAX_LIGNES_IMPORT} lignes au plus.`);

  const vues = new Map<string, number>();
  const lignes: LigneImport[] = [];
  let nonFinalisees = 0;
  donnees.forEach((cellules, i) => {
    if (cellules.every((c) => !c.trim())) return;
    const numero = entete + i + 2;
    const etat = iEtat >= 0 ? (cellules[iEtat] ?? '') : '';
    if (etat.trim() && !normaliserEntete(etat).includes('finalis')) {
      nonFinalisees += 1;
      return;
    }
    const date = dateIso(cellules[iDate] ?? '');
    if (!date) throw new ImportInvalide(`Date illisible à la ligne ${numero}.`);
    const cents = montantCents(cellules[iMontant] ?? '');
    if (cents === null) throw new ImportInvalide(`Montant illisible à la ligne ${numero}.`);
    // La clé garde le libellé entier ; la dépense ou la recette créée en reçoit 200 caractères au plus.
    const libelleComplet = (cellules[iLibelle] ?? '').trim();
    const libelle = libelleComplet.slice(0, MAX_LIBELLE) || '(sans libellé)';
    const compte = iCompte >= 0 ? (cellules[iCompte] ?? '').trim() : '';
    const base = `pennylane|${compte}|${date}|${cents}|${libelleComplet.toLowerCase().replace(/\s+/g, ' ')}`;
    const rang = (vues.get(base) ?? 0) + 1;
    vues.set(base, rang);
    lignes.push({ rang, cle: `${base}|${rang}`, date, libelle, montantCents: cents, compte });
  });
  return { lignes, nonFinalisees };
}
