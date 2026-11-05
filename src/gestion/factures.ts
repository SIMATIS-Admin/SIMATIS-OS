import { and, eq, isNotNull, isNull, lte } from 'drizzle-orm';
import type { Executor } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { jourDe } from '../pilotage/realisees.js';
import { ajouterJours } from './dates.js';
import { etatIkMois } from './ik.js';
import { lireDelaisMandats } from './mandats.js';
import { occurrencesRevenus, type OccurrenceRevenu } from './revenus.js';
import { gestionIkTrajets } from './schema.js';
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

export type FacturesAEmettre = { factures: FactureAEmettre[]; sansMandat: LigneFacture[] };

export type IkRefacturable = {
  trajetId: string;
  mandat: string;
  date: string;
  libelle: string;
  indemniteCents: number | null;
};

// Cadence unique pour l'instant : une facture par mandat, en fin de mois.
export function dateEmissionPrevue(aujourdhui: string): string {
  const [a, m] = aujourdhui.split('-').map(Number) as [number, number];
  const dernier = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${aujourdhui.slice(0, 7)}-${String(dernier).padStart(2, '0')}`;
}

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
}): FacturesAEmettre {
  const emission = dateEmissionPrevue(e.aujourdhui);
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
): Promise<FacturesAEmettre> {
  const emission = dateEmissionPrevue(aujourdhui);
  const [a, m, j] = aujourdhui.split('-').map(Number) as [number, number, number];
  const debut = `${a - 2}-${String(m).padStart(2, '0')}-${String(j).padStart(2, '0')}`;
  const recettes = await occurrencesRevenus(tx, debut, emission);

  const trajets = await tx
    .select()
    .from(gestionIkTrajets)
    .where(
      and(
        eq(gestionIkTrajets.instanceId, currentInstance),
        isNull(gestionIkTrajets.archiveeAt),
        eq(gestionIkTrajets.refacturer, true),
        isNotNull(gestionIkTrajets.mandat),
        lte(gestionIkTrajets.date, emission),
      ),
    );
  // Une indemnité dépend du cumul annuel du véhicule : on demande l'état de chaque (mois, véhicule).
  const groupes = new Map<string, { mois: string; vehiculeId: string }>();
  for (const t of trajets) {
    const mois = t.date.slice(0, 7);
    groupes.set(`${t.vehiculeId}|${mois}`, { mois, vehiculeId: t.vehiculeId });
  }
  const indemnites = new Map<string, number | null>();
  for (const g of groupes.values())
    for (const l of (await etatIkMois(tx, g.mois, g.vehiculeId)).lignes)
      indemnites.set(l.id, l.indemniteCents);
  const ik: IkRefacturable[] = trajets.map((t) => ({
    trajetId: t.id,
    mandat: t.mandat!,
    date: t.date,
    libelle: `${t.trajet} (${t.kmAllerRetour} km)`,
    indemniteCents: indemnites.get(t.id) ?? null,
  }));

  return assemblerFactures({
    recettes,
    ik,
    delaisMandat: await lireDelaisMandats(tx),
    delaiGeneral: (await lireReglages(tx)).delaiPaiementJours,
    aujourdhui,
  });
}
