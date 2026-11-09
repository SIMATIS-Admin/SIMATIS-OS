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

// Sans accents, sans casse : « élodie » trouve « Élodie Fictive ».
const normaliser = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

// Un diagnostic ou un test créé sans entreprise choisie, mais au nom d'une entreprise connue, rejoint son bloc : sinon le test disparaît et le diagnostic reste « Sans entreprise ».
export function rattacher<T extends { entrepriseId?: string | null }>(
  entreprises: Entreprise[],
  elements: T[],
  nomDe: (e: T) => string,
): T[] {
  const parNom = new Map(entreprises.map((e) => [normaliser(e.nom), e.id]));
  return elements.map((el) => {
    if (el.entrepriseId) return el;
    const id = parNom.get(normaliser(nomDe(el)));
    return id ? { ...el, entrepriseId: id } : el;
  });
}

// Le diagnostic en cours est le plus récent non restitué ; à défaut, le plus récent (une année déjà restituée reste dans l'historique).
const diagEnCours = (liste: ProjetDiag[]): ProjetDiag | null => {
  const plusRecent = (a: ProjetDiag, b: ProjetDiag) => b.updatedAt.localeCompare(a.updatedAt);
  const enCours = liste.filter((p) => p.statutDiagnostic !== 'Restitué').sort(plusRecent);
  return enCours[0] ?? [...liste].sort(plusRecent)[0] ?? null;
};

// Les tests vont du plus récent au plus ancien ; un diagnostic déjà rattaché garde sa place.
export function grouper(
  entreprises: Entreprise[],
  projets: ProjetDiag[],
  tests: TestVma[],
): LigneEntreprise[] {
  const lignes: LigneEntreprise[] = entreprises.map((e) => ({
    id: e.id,
    nom: e.nom,
    diag: diagEnCours(projets.filter((p) => p.entrepriseId === e.id)),
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

// Seules comptent les entreprises déjà suivies (diagnostic ou test VMA) ; le reste de l'annuaire n'apparaît pas.
export function lignesSuivies(lignes: LigneEntreprise[]): LigneEntreprise[] {
  return lignes.filter((l) => l.diag !== null || l.tests.length > 0);
}

export function filtrer(lignes: LigneEntreprise[], recherche: string): LigneEntreprise[] {
  const q = normaliser(recherche);
  if (!q) return lignes;
  return lignes.filter(
    (l) =>
      normaliser(l.nom).includes(q) ||
      l.tests.some((t) => normaliser(`${t.contactNom ?? ''} ${t.contactEmail ?? ''}`).includes(q)),
  );
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
  dernier: {
    id: string;
    type: TestVma['type'];
    date: string;
    vma: number | null;
    // Mode portefeuille : le mail met l'allure totale (socle récurrent compris) en avant, pas la VMA seule.
    allure: number | null;
    // Méthode 3.0 : chiffre d'affaires mensuel (régulier variable + engagé + ponctuel), mis en avant avant la VMA ponctuelle.
    caMensuel: number | null;
  } | null;
  // Premiers tests seulement, en ordre chronologique ; une VMA non mesurable n'y entre pas.
  evolution: { date: string; vma: number; methode: string }[];
  // Écart entre le premier et le dernier premier test de l'évolution, d'une même méthode ; null sous deux points.
  ecart: { euros: number; pourcentage: number } | null;
  // La méthode 3.0 ne mesure plus la même chose que la 2.x (la VMA ne compte plus les nouveaux contrats récurrents) :
  // les résultats de méthodes différentes ne se comparent pas.
  methodesMelangees: boolean;
};

// « 2.3 » → « 2 » : la méthode change quand la version majeure change.
const methodeDe = (version: string | null) => (version ?? '').split('.')[0] ?? '';

// Les essais ne rentrent ni dans l'historique ni dans l'évolution (cahier des charges §5.1).
export function resumerVma(tests: TestVma[]): ResumeVma {
  const recus = tests
    .filter((t): t is TestVma & { recueLe: string } => t.recueLe !== null)
    .sort((a, b) => a.recueLe.localeCompare(b.recueLe));
  const dernier = recus.at(-1);
  const evolution = recus
    .filter((t) => t.type === 'premier' && typeof t.resultat?.vma === 'number')
    .map((t) => ({
      date: t.recueLe,
      vma: t.resultat!.vma as number,
      methode: methodeDe(t.version),
    }));

  const dernierPoint = evolution.at(-1);
  const comparables = evolution.filter((p) => p.methode === dernierPoint?.methode);
  const premier = comparables[0];
  const dernierPremier = comparables.at(-1);
  const ecart =
    comparables.length >= 2 && premier && dernierPremier
      ? {
          euros: dernierPremier.vma - premier.vma,
          pourcentage: Math.round(((dernierPremier.vma - premier.vma) / premier.vma) * 100),
        }
      : null;

  return {
    dernier: dernier
      ? {
          id: dernier.id,
          type: dernier.type,
          date: dernier.recueLe,
          vma: typeof dernier.resultat?.vma === 'number' ? dernier.resultat.vma : null,
          caMensuel:
            methodeDe(dernier.version) === '3' &&
            typeof dernier.resultat?.caMensuel?.total === 'number'
              ? dernier.resultat.caMensuel.total
              : null,
          allure:
            methodeDe(dernier.version) !== '3' &&
            dernier.resultat?.modePortefeuille === true &&
            (dernier.resultat.recurrent ?? 0) > 0 &&
            typeof dernier.resultat.allureActuelle === 'number'
              ? dernier.resultat.allureActuelle
              : null,
        }
      : null,
    evolution,
    ecart,
    methodesMelangees: new Set(evolution.map((p) => p.methode)).size > 1,
  };
}
