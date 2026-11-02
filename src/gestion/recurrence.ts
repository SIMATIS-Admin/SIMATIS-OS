import type { Recurrence } from './schema.js';

const PAS_MOIS: Record<Exclude<Recurrence, 'aucune'>, number> = {
  mensuelle: 1,
  trimestrielle: 3,
  annuelle: 12,
};

const joursDuMois = (annee: number, mois: number) =>
  new Date(Date.UTC(annee, mois, 0)).getUTCDate();
const iso = (a: number, m: number, j: number) =>
  `${String(a).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(j).padStart(2, '0')}`;

// Dates d'une série entre `de` et `a` (incluses), au format AAAA-MM-JJ. Le jour d'ancrage est celui
// de `debut` : un 31 tombe le dernier jour des mois courts, puis revient au 31 (pas de dérive).
export function occurrencesEntre(
  serie: { recurrence: Recurrence; debut: string; fin?: string | null },
  de: string,
  a: string,
): string[] {
  const borne = serie.fin && serie.fin < a ? serie.fin : a;
  if (serie.recurrence === 'aucune') {
    return serie.debut >= de && serie.debut <= borne ? [serie.debut] : [];
  }
  const [annee0, mois0, jour0] = serie.debut.split('-').map(Number) as [number, number, number];
  const pas = PAS_MOIS[serie.recurrence];
  const sorties: string[] = [];
  for (let k = 0; ; k++) {
    const indice = mois0 - 1 + k * pas;
    const annee = annee0 + Math.floor(indice / 12);
    const mois = (indice % 12) + 1;
    const date = iso(annee, mois, Math.min(jour0, joursDuMois(annee, mois)));
    if (date > borne) break;
    if (date >= de) sorties.push(date);
  }
  return sorties;
}

// Équivalent mensuel d'un montant récurrent (charges récurrentes / mois).
export const normaliserMensuel = (cents: number, recurrence: Recurrence): number =>
  recurrence === 'aucune' ? 0 : Math.round(cents / PAS_MOIS[recurrence]);

// Veille d'une date (pour clore une série avant « cette occurrence et les suivantes »).
export function veille(jour: string): string {
  const d = new Date(`${jour}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
