export type NoeudCerveau = {
  id: string;
  titre: string;
  categorie: string;
  statut: string | null;
  concerne?: string | null;
};
export type CarteCerveau = {
  noeuds: NoeudCerveau[];
  liens: { de: string; vers: string }[];
  autresFichiers: number;
  tronquee: boolean;
  misAJour: string;
};

// Une couleur par type de note (dossier du second cerveau) ; les catégories inconnues, ajoutées plus
// tard dans le dossier, reçoivent le gris.
export const CATEGORIES: Record<string, { libelle: string; couleur: string }> = {
  profil: { libelle: 'Profil', couleur: '#0c376b' },
  clients: { libelle: 'Clients', couleur: '#41a594' },
  mandats: { libelle: 'Mandats', couleur: '#c98a12' },
  methodes: { libelle: 'Méthodes', couleur: '#7a4fb5' },
  outils: { libelle: 'Outils et sources', couleur: '#2f7fc1' },
  inbox: { libelle: 'Inbox', couleur: '#c0442e' },
  'idees-en-vrac': { libelle: 'Idées en vrac', couleur: '#e0a526' },
  archives: { libelle: 'Archives', couleur: '#7d8ba0' },
  skills: { libelle: 'Skills', couleur: '#2f8f5b' },
  modeles: { libelle: 'Modèles', couleur: '#d6619a' },
  sources: { libelle: 'Sources importées', couleur: '#b8c2d1' },
  racine: { libelle: 'Racine', couleur: '#12253f' },
  // Espace partagé AlpesIA × Simatis.
  reference: { libelle: 'Référence (Christophe)', couleur: '#2f7fc1' },
  prospection: { libelle: 'Prospection (Marc)', couleur: '#c98a12' },
  echanges: { libelle: 'Échanges', couleur: '#d6619a' },
};
const AUTRE = { libelle: 'Autres', couleur: '#9aa6b8' };
export const categorieInfo = (c: string) => CATEGORIES[c] ?? { ...AUTRE, libelle: c };

export type Point = { id: string; x: number; y: number };

// Disposition « par forces » : les notes se repoussent, les notes liées s'attirent. Déterministe
// (départ en spirale, aucun hasard) pour que la carte ne change pas à chaque affichage.
export function disposer(
  noeuds: { id: string }[],
  liens: { de: string; vers: string }[],
  taille = 1000,
): Point[] {
  const n = noeuds.length;
  const index = new Map(noeuds.map((nd, i) => [nd.id, i]));
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const angle = i * 2.399963;
    const rayon = Math.sqrt(i + 1) * (taille / (2 * Math.sqrt(n + 1)));
    x[i] = Math.cos(angle) * rayon;
    y[i] = Math.sin(angle) * rayon;
  }
  const aretes = liens
    .map((l) => [index.get(l.de), index.get(l.vers)] as const)
    .filter((a): a is readonly [number, number] => a[0] !== undefined && a[1] !== undefined);
  const degre = new Float64Array(n);
  for (const [a, b] of aretes) {
    degre[a] = (degre[a] ?? 0) + 1;
    degre[b] = (degre[b] ?? 0) + 1;
  }

  const k = taille / Math.sqrt(n + 1);
  const tours = n > 1500 ? 60 : 220;
  for (let t = 0; t < tours; t++) {
    const refroidissement = 1 - t / tours;
    const dx = new Float64Array(n);
    const dy = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let ex = (x[i] as number) - (x[j] as number);
        let ey = (y[i] as number) - (y[j] as number);
        let d2 = ex * ex + ey * ey;
        if (d2 < 0.01) {
          ex = 0.1 * (i % 2 ? 1 : -1);
          ey = 0.1;
          d2 = 0.02;
        }
        const f = (k * k) / d2;
        dx[i] = (dx[i] as number) + ex * f;
        dy[i] = (dy[i] as number) + ey * f;
        dx[j] = (dx[j] as number) - ex * f;
        dy[j] = (dy[j] as number) - ey * f;
      }
    }
    for (const [a, b] of aretes) {
      const ex = (x[a] as number) - (x[b] as number);
      const ey = (y[a] as number) - (y[b] as number);
      const d = Math.sqrt(ex * ex + ey * ey) || 0.1;
      const f = d / k;
      dx[a] = (dx[a] as number) - ex * f;
      dy[a] = (dy[a] as number) - ey * f;
      dx[b] = (dx[b] as number) + ex * f;
      dy[b] = (dy[b] as number) + ey * f;
    }
    for (let i = 0; i < n; i++) {
      // Gravité vers le centre : les notes sans lien restent dans le cadre.
      dx[i] = (dx[i] as number) - (x[i] as number) * 0.05;
      dy[i] = (dy[i] as number) - (y[i] as number) * 0.05;
      const d = Math.sqrt((dx[i] as number) ** 2 + (dy[i] as number) ** 2) || 1;
      const pas = Math.min(d, k * 0.6 * refroidissement + 1);
      x[i] = (x[i] as number) + ((dx[i] as number) / d) * pas;
      y[i] = (y[i] as number) + ((dy[i] as number) / d) * pas;
    }
  }
  return noeuds.map((nd, i) => ({ id: nd.id, x: x[i] as number, y: y[i] as number }));
}

// Notes reliées à une note, dans les deux sens (un lien [[a]] dans b relie aussi a à b).
export const voisins = (carte: Pick<CarteCerveau, 'liens'>, id: string) => {
  const sortants: string[] = [];
  const entrants: string[] = [];
  for (const l of carte.liens) {
    if (l.de === id) sortants.push(l.vers);
    if (l.vers === id) entrants.push(l.de);
  }
  return { sortants, entrants };
};
