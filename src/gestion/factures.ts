import type { Executor } from '../db.js';
import { jourDe } from '../pilotage/realisees.js';
import { ajouterJours, dateEmissionPrevue } from './dates.js';
import { trajetsRefacturables, type IkRefacturable } from './ik.js';
import { lireDelaisMandats } from './mandats.js';
import { occurrencesRevenus, type OccurrenceRevenu } from './revenus.js';
import { lireReglages } from './tresorerie.js';

// Les factures à émettre d'un mandat, calculées à la demande. Rien n'est stocké ici : l'émission, qui
// fige une facture, vient avec la livraison suivante.
export type SorteLigne = 'recurrent' | 'commission' | 'frais' | 'ik';

export type LigneFacture = {
  cle: string;
  sorte: SorteLigne;
  libelle: string;
  date: string;
  // null = montant inconnu (trajet sans barème validé) : jamais inventé, jamais compté.
  montantHtCents: number | null;
  tvaCents: number | null;
  certitude: OccurrenceRevenu['certitude'] | null;
  avertissement: string | null;
};

export type FactureAEmettre = {
  mandat: string;
  emissionPrevue: string;
  // Délai effectif (celui du mandat, sinon le général) et délai propre au mandat, distincts.
  delaiJours: number | null;
  delaiMandatJours: number | null;
  encaissementAttendu: string | null;
  totalHtCents: number;
  lignes: LigneFacture[];
  avertissements: string[];
};

export { dateEmissionPrevue, type IkRefacturable };

export type FacturesAEmettre = { factures: FactureAEmettre[]; sansMandat: LigneFacture[] };

const SORTE_PAR_TYPE: Record<OccurrenceRevenu['type'], SorteLigne> = {
  abonnement: 'recurrent',
  commission: 'commission',
  autre: 'commission',
  refacturation: 'frais',
};

function ligneDeRecette(o: OccurrenceRevenu): LigneFacture {
  const sorte = SORTE_PAR_TYPE[o.type];
  return {
    cle: `revenu:${o.cle}`,
    sorte,
    libelle: o.libelle,
    date: o.date,
    montantHtCents: o.montantHtCents,
    tvaCents: o.tvaCents,
    certitude: o.certitude,
    avertissement: sorte === 'frais' && o.tvaCents == null ? 'TVA à renseigner' : null,
  };
}

const ligneDeIk = (t: IkRefacturable): LigneFacture => ({
  cle: `ik:${t.trajetId}`,
  sorte: 'ik',
  libelle: t.libelle,
  date: t.date,
  montantHtCents: t.indemniteCents,
  tvaCents: null,
  certitude: 'certaine',
  avertissement: t.indemniteCents == null ? 'Montant IK inconnu : aucun barème validé' : null,
});

const parDate = (x: LigneFacture, y: LigneFacture) =>
  x.date.localeCompare(y.date) || x.cle.localeCompare(y.cle);

// Moteur pur : testé sans base.
export function assemblerFactures(e: {
  recettes: OccurrenceRevenu[];
  ik: IkRefacturable[];
  delaisMandat: Map<string, number | null>;
  delaiGeneral: number | null;
  aujourdhui: string;
  // Limite des lignes ; par défaut la prochaine émission de cadence.
  jusqua?: string;
}): FacturesAEmettre {
  const emission = e.jusqua ?? dateEmissionPrevue(e.aujourdhui);
  const retenues = e.recettes.filter(
    (o) => o.etat === 'prevue' && o.certitude !== 'hypothese' && o.date <= emission,
  );
  const parMandat = new Map<string, LigneFacture[]>();
  const sansMandat: LigneFacture[] = [];
  for (const o of retenues) {
    if (!o.mandat) sansMandat.push(ligneDeRecette(o));
    else parMandat.set(o.mandat, [...(parMandat.get(o.mandat) ?? []), ligneDeRecette(o)]);
  }
  for (const t of e.ik.filter((x) => x.date <= emission))
    parMandat.set(t.mandat, [...(parMandat.get(t.mandat) ?? []), ligneDeIk(t)]);

  const factures = [...parMandat.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mandat, lignes]): FactureAEmettre => {
      const delaiJours = e.delaisMandat.get(mandat) ?? e.delaiGeneral;
      const avertissements: string[] = [];
      if (delaiJours == null)
        avertissements.push('Délai de paiement inconnu : encaissement non daté');
      return {
        mandat,
        emissionPrevue: emission,
        delaiJours,
        delaiMandatJours: e.delaisMandat.get(mandat) ?? null,
        encaissementAttendu: delaiJours == null ? null : ajouterJours(emission, delaiJours),
        totalHtCents: lignes.reduce((s, l) => s + (l.montantHtCents ?? 0), 0),
        lignes: lignes.sort(parDate),
        avertissements,
      };
    });
  return { factures, sansMandat: sansMandat.sort(parDate) };
}

export async function facturesParMandat(
  tx: Executor,
  aujourdhui: string = jourDe(new Date()),
  // Limite des lignes ; par défaut la prochaine émission de cadence (fin de mois).
  jusqua?: string,
): Promise<FacturesAEmettre> {
  const limite = jusqua ?? dateEmissionPrevue(aujourdhui);
  const [a, m, j] = aujourdhui.split('-').map(Number) as [number, number, number];
  const debut = `${a - 2}-${String(m).padStart(2, '0')}-${String(j).padStart(2, '0')}`;
  return assemblerFactures({
    recettes: await occurrencesRevenus(tx, debut, limite),
    ik: await trajetsRefacturables(tx, limite),
    delaisMandat: await lireDelaisMandats(tx),
    delaiGeneral: (await lireReglages(tx)).delaiPaiementJours,
    aujourdhui,
    jusqua,
  });
}
