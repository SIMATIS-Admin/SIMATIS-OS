import type { OccurrenceDepense, OccurrenceRevenu } from '../../api.js';
import { TYPES_REVENU } from '../GestionRevenuTiroir.js';

// Dépenses (TTC) et recettes (HT) vues comme une seule liste. La base reste affichée sur chaque
// ligne : on ne mélange jamais TTC et HT dans un même total.
export type Mouvement = {
  cle: string;
  sens: 'depense' | 'recette';
  date: string;
  libelle: string;
  detail: string;
  origine: 'Saisi' | 'Récurrent';
  etat: 'payee' | 'prevue' | 'emise' | 'encaissee' | 'ignoree';
  base: 'TTC' | 'HT';
  montantCents: number;
  depense?: OccurrenceDepense;
  recette?: OccurrenceRevenu;
};

export type FiltreMouvement = 'tout' | 'depenses' | 'recettes' | 'prevus' | 'recurrents';
export type CritereMouvement = {
  type: FiltreMouvement;
  refacturables: boolean;
  recherche: string;
  affectation: string;
};
type NomAffectation = (a: { cible: string; mandat?: string }) => string;

const depuisDepense = (o: OccurrenceDepense): Mouvement => ({
  cle: o.cle,
  sens: 'depense',
  date: o.date,
  libelle: o.libelle,
  detail:
    (o.categorie ?? 'Sans catégorie') +
    (o.payeur === 'associe' ? ' · compte d’associé, sans sortie bancaire' : ''),
  origine: o.recurrente ? 'Récurrent' : 'Saisi',
  etat: o.etat === 'a_venir' ? 'prevue' : o.etat,
  base: 'TTC',
  montantCents: -o.montantTtcCents,
  depense: o,
});

const depuisRecette = (r: OccurrenceRevenu): Mouvement => ({
  cle: r.cle,
  sens: 'recette',
  date: r.etat === 'encaissee' && r.dateEncaissement ? r.dateEncaissement : r.date,
  libelle: r.libelle,
  detail:
    (TYPES_REVENU.find(([k]) => k === r.type)?.[1] ?? '') +
    (r.referenceFacture ? ` · ${r.referenceFacture}` : ''),
  origine: r.recurrente ? 'Récurrent' : 'Saisi',
  etat: r.etat,
  base: 'HT',
  montantCents: r.montantHtCents,
  recette: r,
});

export function fusionnerMouvements(
  depenses: OccurrenceDepense[],
  revenus: OccurrenceRevenu[],
): Mouvement[] {
  return [...depenses.map(depuisDepense), ...revenus.map(depuisRecette)].sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      (a.sens === b.sens ? 0 : a.sens === 'depense' ? -1 : 1) ||
      a.libelle.localeCompare(b.libelle, 'fr'),
  );
}

export function filtrerMouvements(
  mouvements: Mouvement[],
  c: CritereMouvement,
  nomAff: NomAffectation,
): Mouvement[] {
  const q = c.recherche.trim().toLowerCase();
  const affectationsDe = (m: Mouvement) =>
    m.depense
      ? m.depense.affectations.map(nomAff)
      : m.recette?.mandat
        ? [nomAff({ cible: 'mandat', mandat: m.recette.mandat })]
        : [];
  return mouvements.filter((m) => {
    if (c.type === 'depenses' && m.sens !== 'depense') return false;
    if (c.type === 'recettes' && m.sens !== 'recette') return false;
    if (c.type === 'prevus' && m.etat !== 'prevue' && m.etat !== 'emise') return false;
    if (c.type === 'recurrents' && m.origine !== 'Récurrent') return false;
    // Seules les dépenses se refacturent : le filtre écarte donc les recettes.
    if (c.refacturables && !m.depense?.refacturable) return false;
    const affectations = affectationsDe(m);
    if (c.affectation && !affectations.includes(c.affectation)) return false;
    return !q || `${m.libelle} ${m.detail} ${affectations.join(' ')}`.toLowerCase().includes(q);
  });
}
