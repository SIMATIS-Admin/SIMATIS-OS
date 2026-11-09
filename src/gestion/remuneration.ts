import { z } from 'zod';
import { ajouterJours } from './dates.js';
import type { Mouvement } from './tresorerie.js';

// Rémunération du dirigeant chargée : le net versé et les cotisations URSSAF sortent du compte de la
// société. Moteur pur. Aucun taux n'est supposé : Marc les saisit, l'OS ne fait que le calcul.
export const BASES_REMUNERATION = ['brut', 'net', 'cout'] as const;
export const PERIODICITES = ['mensuelle', 'trimestrielle'] as const;

const taux = z.number().min(0).max(100);
export const remunerationSchema = z.object({
  actif: z.boolean(),
  // Ce que représente le montant saisi : brut, net versé, ou coût total pour la société.
  base: z.enum(BASES_REMUNERATION),
  montantCents: z.number().int().min(1),
  // Pourcentages du brut (cotisations salariales retenues, cotisations patronales en plus).
  tauxSalarial: taux.max(99.99),
  tauxPatronal: taux,
  periodicite: z.enum(PERIODICITES),
});
export type Remuneration = z.infer<typeof remunerationSchema>;

export type DecompositionRemuneration = {
  brutCents: number;
  netCents: number;
  salarialCents: number;
  patronalCents: number;
  // Salariales + patronales : ce que l'URSSAF prélève.
  urssafCents: number;
  coutCents: number;
};

export function decomposer(r: Remuneration): DecompositionRemuneration {
  const ts = r.tauxSalarial / 100;
  const tp = r.tauxPatronal / 100;
  const brut =
    r.base === 'brut'
      ? r.montantCents
      : r.base === 'net'
        ? r.montantCents / (1 - ts)
        : r.montantCents / (1 + tp);
  const brutCents = Math.round(brut);
  const salarialCents = Math.round(brutCents * ts);
  const patronalCents = Math.round(brutCents * tp);
  return {
    brutCents,
    netCents: brutCents - salarialCents,
    salarialCents,
    patronalCents,
    urssafCents: salarialCents + patronalCents,
    coutCents: brutCents + patronalCents,
  };
}

const mois = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
const indexMois = (jour: string) => Number(jour.slice(0, 4)) * 12 + Number(jour.slice(5, 7)) - 1;
const dernierJour = (m: string) => {
  const [a, mm] = m.split('-').map(Number) as [number, number];
  return ajouterJours(
    `${mm === 12 ? a + 1 : a}-${String(mm === 12 ? 1 : mm + 1).padStart(2, '0')}-01`,
    -1,
  );
};

// Net versé le dernier jour de chaque mois ; cotisations dues le 15 du mois suivant (mensuel) ou le 15 du
// mois suivant la fin du trimestre civil (trimestriel). Seuls les flux postérieurs au solde (ou à hier,
// sans solde) et antérieurs à `fin` sont projetés : ce sont des hypothèses de calendrier, marquées estimées.
export function mouvementsRemuneration(
  r: Remuneration,
  p: { soldeDate: string | null; aujourdhui: string; fin: string },
): Mouvement[] {
  if (!r.actif) return [];
  const d = decomposer(r);
  const apres = p.soldeDate ?? ajouterJours(p.aujourdhui, -1);
  const dans = (date: string) => date > apres && date <= p.fin;
  const sorties: Mouvement[] = [];
  const debut = indexMois(apres) - 3;
  const finIdx = indexMois(p.fin);
  const detail = `brut ${(d.brutCents / 100).toLocaleString('fr-FR')} €`;
  for (let i = debut; i <= finIdx; i++) {
    const m = mois(i);
    const paie = dernierJour(m);
    if (dans(paie))
      sorties.push({
        date: paie,
        sens: 'sortie',
        libelle: 'Rémunération (net versé)',
        montantCents: d.netCents,
        nature: 'depense',
        ref: `remuneration:net:${m}`,
        estime: true,
        note: `Rémunération projetée, ${detail}`,
      });
    const trimestre = r.periodicite === 'trimestrielle';
    if (trimestre && (i % 12) % 3 !== 2) continue;
    const echeance = `${mois(i + 1)}-15`;
    if (!dans(echeance)) continue;
    const nb = trimestre ? 3 : 1;
    sorties.push({
      date: echeance,
      sens: 'sortie',
      libelle: trimestre ? 'Cotisations URSSAF (trimestre)' : 'Cotisations URSSAF',
      montantCents: d.urssafCents * nb,
      nature: 'depense',
      ref: `remuneration:urssaf:${m}`,
      estime: true,
      note: `Cotisations salariales + patronales sur la rémunération projetée, ${detail}`,
    });
  }
  return sorties;
}
