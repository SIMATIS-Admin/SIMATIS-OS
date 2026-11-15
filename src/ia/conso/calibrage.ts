// Conversion du coût équivalent en points de jauge. Les jauges ne bougent que par points entiers
// (côté Claude) et englobent aussi ce qu'on ne voit pas (le Chat claude.ai) : le coefficient est
// donc estimé sur des blocs d'au moins 3 points, en écartant les blocs où la hausse est
// anormalement forte pour le coût observé.

export type PointJauge = { at: Date; utilise: number; reset: Date | null };
export type Coefficient = { k: number; points: number; estime: boolean } | null;

const HEURE_MS = 3_600_000;
const POINTS_PAR_BLOC = 3;
const POINTS_FIABLES = 20;

const memeReset = (a: Date | null, b: Date | null) =>
  // Le collecteur arrondit parfois l'heure de renouvellement : une minute d'écart reste la même fenêtre.
  (a === null && b === null) ||
  (a !== null && b !== null && Math.abs(a.getTime() - b.getTime()) < 60_000);

// Un relevé n'encadre une heure que s'il en est proche : après une coupure du collecteur, la hausse
// de plusieurs heures ne doit pas retomber sur une seule.
const ECART_MAX_MS = 15 * 60_000;

export function hausseParHeure(points: PointJauge[], heures: Date[]): Map<number, number | null> {
  const tries = [...points].sort((a, b) => a.at.getTime() - b.at.getTime());
  const resultat = new Map<number, number | null>();
  // Un seul parcours : les heures sont traitées dans l'ordre, l'index des relevés ne recule jamais.
  const ordre = [...heures].sort((a, b) => a.getTime() - b.getTime());
  let i = -1;
  for (const heure of ordre) {
    const t = heure.getTime();
    while (i + 1 < tries.length && (tries[i + 1]?.at.getTime() ?? Infinity) <= t) i++;
    const debut = i >= 0 ? tries[i] : undefined;
    let j = i;
    while (j + 1 < tries.length && (tries[j + 1]?.at.getTime() ?? Infinity) <= t + HEURE_MS - 1)
      j++;
    const fin = j >= 0 ? tries[j] : undefined;
    const proches =
      debut !== undefined &&
      fin !== undefined &&
      fin !== debut &&
      t - debut.at.getTime() <= ECART_MAX_MS &&
      t + HEURE_MS - fin.at.getTime() <= ECART_MAX_MS;
    const hausse =
      proches && memeReset(debut.reset, fin.reset) ? fin.utilise - debut.utilise : null;
    resultat.set(t, hausse !== null && hausse >= 0 ? hausse : null);
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

// Sans historique de jauge, une seule lecture suffit à une première estimation : le % déjà
// utilisé dans la fenêtre en cours, rapporté au coût observé depuis son début (début = heure de
// renouvellement moins la durée de la fenêtre). La part non observée (le Chat) la gonfle un peu :
// elle reste marquée « ≈ » jusqu'à ce que l'historique prenne le relais.
export function coefficientInstantane(
  point: PointJauge,
  couts: Map<number, number>,
  dureeMs: number,
): Coefficient {
  if (!point.reset || point.utilise <= 0) return null;
  const debut = point.reset.getTime() - dureeMs;
  let cout = 0;
  for (const [heure, c] of couts)
    if (heure + HEURE_MS > debut && heure <= point.at.getTime()) cout += c;
  if (cout <= 0) return null;
  return { k: point.utilise / cout, points: point.utilise, estime: true };
}
