import type { ProjetDiag, TestVma } from '../../api.js';

// Une ligne de l'écran : une entreprise avec son diagnostic et ses tests VMA.
// Un diagnostic sans entreprise garde sa propre ligne, sans identifiant (id null).
export type LigneEntreprise = {
  id: string | null;
  nom: string;
  diag: ProjetDiag | null;
  tests: TestVma[];
};

export type Entreprise = { id: string; nom: string; secteur: string | null };

// Les tests vont du plus récent au plus ancien ; un diagnostic déjà rattaché garde sa place.
export function grouper(
  entreprises: Entreprise[],
  projets: ProjetDiag[],
  tests: TestVma[],
): LigneEntreprise[] {
  const lignes: LigneEntreprise[] = entreprises.map((e) => ({
    id: e.id,
    nom: e.nom,
    diag: projets.find((p) => p.entrepriseId === e.id) ?? null,
    tests: tests
      .filter((t) => t.entrepriseId === e.id)
      .sort((a, b) => b.creeLe.localeCompare(a.creeLe)),
  }));

  const connus = new Set(entreprises.map((e) => e.id));
  for (const p of projets) {
    if (p.entrepriseId && connus.has(p.entrepriseId)) continue;
    lignes.push({ id: null, nom: p.nom, diag: p, tests: [] });
  }
  return lignes;
}

// Sans accents, sans casse : « élodie » trouve « Élodie Fictive ».
const normaliser = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

export function filtrer(lignes: LigneEntreprise[], recherche: string): LigneEntreprise[] {
  const q = normaliser(recherche);
  if (!q) return lignes;
  return lignes.filter((l) => normaliser(l.nom).includes(q));
}

// La page demandée est bornée à [1, pages] : une recherche qui réduit la liste ne laisse pas une page vide.
export function paginer<T>(
  liste: T[],
  page: number,
  parPage: number,
): { items: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(liste.length / parPage));
  const borne = Math.min(Math.max(1, page), pages);
  const debut = (borne - 1) * parPage;
  return { items: liste.slice(debut, debut + parPage), page: borne, pages };
}

export type ResumeVma = {
  dernier: { type: TestVma['type']; date: string; vma: number | null } | null;
  // Premiers tests seulement, en ordre chronologique ; une VMA non mesurable n'y entre pas.
  evolution: { date: string; vma: number }[];
  // Écart entre le premier et le dernier premier test de l'évolution ; null sous deux points.
  ecart: { euros: number; pourcentage: number } | null;
};

// Les essais ne rentrent ni dans l'historique ni dans l'évolution (cahier des charges §5.1).
export function resumerVma(tests: TestVma[]): ResumeVma {
  const recus = tests
    .filter((t): t is TestVma & { recueLe: string } => t.recueLe !== null)
    .sort((a, b) => a.recueLe.localeCompare(b.recueLe));
  const dernier = recus.at(-1);
  const evolution = recus
    .filter((t) => t.type === 'premier' && typeof t.resultat?.vma === 'number')
    .map((t) => ({ date: t.recueLe, vma: t.resultat!.vma as number }));

  const premier = evolution[0];
  const dernierPremier = evolution.at(-1);
  const ecart =
    evolution.length >= 2 && premier && dernierPremier
      ? {
          euros: dernierPremier.vma - premier.vma,
          pourcentage: Math.round(((dernierPremier.vma - premier.vma) / premier.vma) * 100),
        }
      : null;

  return {
    dernier: dernier
      ? {
          type: dernier.type,
          date: dernier.recueLe,
          vma: typeof dernier.resultat?.vma === 'number' ? dernier.resultat.vma : null,
        }
      : null,
    evolution,
    ecart,
  };
}
