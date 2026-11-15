// Conversion du coût équivalent en points de jauge. Les jauges ne bougent que par points entiers
// (côté Claude) et englobent aussi ce qu'on ne voit pas (le Chat claude.ai) : le coefficient est
// donc estimé sur des blocs d'au moins 3 points, en écartant les blocs où la hausse est
// anormalement forte pour le coût observé.

export type PointJauge = { at: Date; utilise: number; reset: Date | null };
export type Coefficient = { k: number; points: number; estime: boolean } | null;

const HEURE_MS = 3_600_000;
const POINTS_PAR_BLOC = 3;
const POINTS_FIABLES = 20;

function dernierAvant(points: PointJauge[], limite: number): PointJauge | undefined {
  let trouve: PointJauge | undefined;
  for (const p of points) {
    if (p.at.getTime() <= limite) trouve = p;
    else break;
  }
  return trouve;
}

const memeReset = (a: Date | null, b: Date | null) =>
  // Le collecteur arrondit parfois l'heure de renouvellement : une minute d'écart reste la même fenêtre.
  (a === null && b === null) ||
  (a !== null && b !== null && Math.abs(a.getTime() - b.getTime()) < 60_000);

export function hausseParHeure(points: PointJauge[], heures: Date[]): Map<number, number | null> {
  const tries = [...points].sort((a, b) => a.at.getTime() - b.at.getTime());
  const resultat = new Map<number, number | null>();
  for (const heure of heures) {
    const debut = dernierAvant(tries, heure.getTime());
    const fin = dernierAvant(tries, heure.getTime() + HEURE_MS - 1);
    const hausse =
      debut && fin && fin !== debut && memeReset(debut.reset, fin.reset)
        ? fin.utilise - debut.utilise
        : null;
    resultat.set(heure.getTime(), hausse !== null && hausse >= 0 ? hausse : null);
  }
  return resultat;
}

export function coefficient(
  hausses: Map<number, number | null>,
  couts: Map<number, number>,
): Coefficient {
  const heures = [...new Set([...hausses.keys(), ...couts.keys()])].sort((a, b) => a - b);
  const blocs: { hausse: number; cout: number }[] = [];
  let bloc = { hausse: 0, cout: 0 };
  for (const h of heures) {
    const hausse = hausses.get(h);
    // Une heure sans mesure coupe le bloc : on ne relie pas deux fenêtres de jauge différentes.
    if (hausse === null || hausse === undefined) {
      bloc = { hausse: 0, cout: 0 };
      continue;
    }
    bloc = { hausse: bloc.hausse + hausse, cout: bloc.cout + (couts.get(h) ?? 0) };
    if (bloc.hausse >= POINTS_PAR_BLOC) {
      if (bloc.cout > 0) blocs.push(bloc);
      bloc = { hausse: 0, cout: 0 };
    }
  }
  if (blocs.length === 0) return null;
  const rapports = blocs.map((b) => b.hausse / b.cout).sort((a, b) => a - b);
  const mediane = rapports[Math.floor((rapports.length - 1) / 2)] ?? 0;
  const retenus = blocs.filter((b) => b.hausse / b.cout <= mediane);
  const k = retenus.reduce((s, b) => s + b.hausse, 0) / retenus.reduce((s, b) => s + b.cout, 0);
  const points = blocs.reduce((s, b) => s + b.hausse, 0);
  return { k, points, estime: points < POINTS_FIABLES };
}

export function nonAttribue(hausse: number | null, cout: number, c: Coefficient): number | null {
  if (hausse === null || c === null) return null;
  const reste = hausse - c.k * cout;
  return reste >= 1 ? Math.round(reste * 10) / 10 : 0;
}
