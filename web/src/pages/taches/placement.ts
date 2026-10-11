import { heureParis, parisVersIso } from './creneaux.js';

// Hour grid, Pipedrive-like: rows of 30 minutes from 7:00 (row 0) to 20:30 (row 27).
export const DEBUT = 7;
export const LIGNES = 28;

export type Place = { ligne: number; hauteur: number; colonne: number; colonnes: number };

const ligneDe = (iso: string) => {
  const [h, m] = heureParis(iso).split(':').map(Number) as [number, number];
  return Math.min(LIGNES - 1, Math.max(0, (h - DEBUT) * 2 + Math.floor(m / 30)));
};

// Items of one day; overlapping ones share the width (greedy columns per overlap cluster).
export function placer(
  items: { id: string; debut: string; minutes: number }[],
): Map<string, Place> {
  const rangs = items
    .map((it) => {
      const ligne = ligneDe(it.debut);
      const hauteur = Math.max(1, Math.min(Math.ceil(it.minutes / 30), LIGNES - ligne));
      return { id: it.id, ligne, fin: ligne + hauteur, hauteur };
    })
    .sort((a, b) => a.ligne - b.ligne || b.hauteur - a.hauteur);
  const places = new Map<string, Place>();
  let groupe: typeof rangs = [];
  let finGroupe = -1;
  let colonnes: number[] = [];
  const clore = () => {
    const n = Math.max(1, colonnes.length);
    for (const r of groupe) {
      const p = places.get(r.id);
      if (p) p.colonnes = n;
    }
    groupe = [];
    colonnes = [];
  };
  for (const r of rangs) {
    if (r.ligne >= finGroupe) clore();
    let colonne = colonnes.findIndex((fin) => fin <= r.ligne);
    if (colonne === -1) colonne = colonnes.push(r.fin) - 1;
    else colonnes[colonne] = r.fin;
    places.set(r.id, { ligne: r.ligne, hauteur: r.hauteur, colonne, colonnes: 1 });
    groupe.push(r);
    finGroupe = Math.max(finGroupe, r.fin);
  }
  clore();
  return places;
}

export const versCreneau = (jour: string, ligne: number) => {
  const minutes = DEBUT * 60 + ligne * 30;
  return parisVersIso(
    jour,
    `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`,
  );
};
