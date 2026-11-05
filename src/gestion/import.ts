import { and, eq, inArray } from 'drizzle-orm';
import type { Feuille } from '../base-vivante/lecture.js';
import { currentInstance } from '../db/columns.js';
import type { Executor } from '../db.js';
import { ajouterJours } from './dates.js';
import { lireTransactions, type LigneImport } from './import-pennylane.js';
import { occurrencesRevenus, type OccurrenceRevenu } from './revenus.js';
import { gestionImportCles } from './schema.js';
import { occurrencesDepenses, type OccurrenceVue } from './service.js';

// Import des transactions bancaires : on propose, Marc décide. Rien n'est écrit tant qu'il n'a pas validé.
const FENETRE_SORTIE_JOURS = 7;
const FENETRE_ENTREE_JOURS = 45;

export type Rapprochement = {
  type: 'depense' | 'recette';
  id: string;
  // Date de l'échéance d'origine dans la série (clé de l'occurrence), pas la date éventuellement déplacée.
  dateOrigine: string;
  libelle: string;
  date: string;
  montantCents: number;
};

export type LigneAnalysee = LigneImport & {
  sens: 'sortie' | 'entree';
  issue: 'nouvelle' | 'deja' | 'a_verifier';
  raison: string | null;
  rapprochement: Rapprochement | null;
};

const ecartJours = (a: string, b: string) =>
  Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

// Une ligne ↔ une échéance prévue, à montant identique et date proche. On apparie d'abord les plus
// proches, et une échéance n'est proposée qu'à une seule ligne.
export function proposerRapprochements(
  lignes: LigneImport[],
  depenses: OccurrenceVue[],
  recettes: OccurrenceRevenu[],
): Map<string, Rapprochement> {
  const candidats: { cle: string; ecart: number; cible: string; r: Rapprochement }[] = [];
  for (const l of lignes) {
    if (l.montantCents < 0) {
      for (const d of depenses) {
        if (d.etat !== 'a_venir' || d.payeur !== 'societe') continue;
        if (d.montantTtcCents !== -l.montantCents) continue;
        const ecart = ecartJours(l.date, d.date);
        if (ecart > FENETRE_SORTIE_JOURS) continue;
        candidats.push({
          cle: l.cle,
          ecart,
          cible: `depense|${d.cle}`,
          r: {
            type: 'depense',
            id: d.depenseId,
            dateOrigine: d.cle.split('|')[1] ?? d.date,
            libelle: d.libelle,
            date: d.date,
            montantCents: d.montantTtcCents,
          },
        });
      }
    } else {
      for (const r of recettes) {
        if (r.etat !== 'prevue' && r.etat !== 'emise') continue;
        const montant = r.montantHtCents + (r.tvaCents ?? 0);
        if (montant !== l.montantCents) continue;
        const ecart = ecartJours(l.date, r.date);
        if (ecart > FENETRE_ENTREE_JOURS) continue;
        candidats.push({
          cle: l.cle,
          ecart,
          cible: `recette|${r.cle}`,
          r: {
            type: 'recette',
            id: r.revenuId,
            dateOrigine: r.cle.split('|')[1] ?? r.date,
            libelle: r.libelle,
            date: r.date,
            montantCents: montant,
          },
        });
      }
    }
  }
  candidats.sort((a, b) => a.ecart - b.ecart || a.cle.localeCompare(b.cle));
  const lignesPrises = new Set<string>();
  const ciblesPrises = new Set<string>();
  const resultat = new Map<string, Rapprochement>();
  for (const c of candidats) {
    if (lignesPrises.has(c.cle) || ciblesPrises.has(c.cible)) continue;
    lignesPrises.add(c.cle);
    ciblesPrises.add(c.cible);
    resultat.set(c.cle, c.r);
  }
  return resultat;
}

export type AnalyseImport = {
  lignes: LigneAnalysee[];
  compteurs: { nouvelles: number; deja: number; aVerifier: number; nonFinalisees: number };
  avertissements: string[];
};

export async function analyserImport(tx: Executor, f: Feuille): Promise<AnalyseImport> {
  const { lignes, nonFinalisees } = lireTransactions(f);
  const avertissements: string[] = [];
  if (lignes.length === 0) {
    avertissements.push('Aucune transaction à importer dans ce fichier.');
    return {
      lignes: [],
      compteurs: { nouvelles: 0, deja: 0, aVerifier: 0, nonFinalisees },
      avertissements,
    };
  }
  const connues = new Set(
    (
      await tx
        .select({ cle: gestionImportCles.cle })
        .from(gestionImportCles)
        .where(
          and(
            eq(gestionImportCles.instanceId, currentInstance),
            inArray(
              gestionImportCles.cle,
              lignes.map((l) => l.cle),
            ),
          ),
        )
    ).map((r) => r.cle),
  );
  const dates = lignes.map((l) => l.date).sort();
  const de = ajouterJours(dates[0]!, -FENETRE_ENTREE_JOURS);
  const a = ajouterJours(dates.at(-1)!, FENETRE_ENTREE_JOURS);
  const nouvelles = lignes.filter((l) => !connues.has(l.cle));
  const rapprochements = proposerRapprochements(
    nouvelles,
    await occurrencesDepenses(tx, de, a),
    await occurrencesRevenus(tx, de, a),
  );

  const analysees = lignes.map((l): LigneAnalysee => {
    const sens = l.montantCents < 0 ? 'sortie' : 'entree';
    if (connues.has(l.cle))
      return { ...l, sens, issue: 'deja', raison: 'Déjà importée', rapprochement: null };
    const rapprochement = rapprochements.get(l.cle) ?? null;
    if (rapprochement)
      return {
        ...l,
        sens,
        issue: 'a_verifier',
        raison: `Ressemble à « ${rapprochement.libelle} » prévu le ${rapprochement.date}`,
        rapprochement,
      };
    if (sens === 'entree')
      return {
        ...l,
        sens,
        issue: 'a_verifier',
        raison: 'Aucune recette prévue ne correspond : à préciser',
        rapprochement: null,
      };
    return { ...l, sens, issue: 'nouvelle', raison: null, rapprochement: null };
  });
  const compte = (i: LigneAnalysee['issue']) => analysees.filter((l) => l.issue === i).length;
  return {
    lignes: analysees,
    compteurs: {
      nouvelles: compte('nouvelle'),
      deja: compte('deja'),
      aVerifier: compte('a_verifier'),
      nonFinalisees,
    },
    avertissements,
  };
}
