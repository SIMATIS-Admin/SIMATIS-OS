import { and, eq, inArray } from 'drizzle-orm';
import type { Feuille } from '../base-vivante/lecture.js';
import { currentInstance } from '../db/columns.js';
import type { Executor } from '../db.js';
import { ajouterJours } from './dates.js';
import { ImportInvalide, lireTransactions, type LigneImport } from './import-pennylane.js';
import {
  creerRevenu,
  modifierOccurrenceRevenu,
  modifierRevenu,
  occurrencesRevenus,
  revenuSchema,
  type OccurrenceRevenu,
} from './revenus.js';
import { gestionImportCles } from './schema.js';
import {
  creerDepense,
  depenseSchema,
  modifierOccurrence,
  modifierSerie,
  occurrencesDepenses,
  type OccurrenceVue,
} from './service.js';

// Import des transactions bancaires : on propose, Marc décide. Rien n'est écrit tant qu'il n'a pas validé.
const FENETRE_SORTIE_JOURS = 7;
const FENETRE_ENTREE_JOURS = 45;

export type Rapprochement = {
  type: 'depense' | 'recette';
  id: string;
  // Une série se rapproche occurrence par occurrence ; une ligne unique change d'état.
  recurrente: boolean;
  // Cible déjà payée ou encaissée (saisie en « réelle ») : la ligne du relevé la confirme, elle ne la crée pas.
  dejaCompte: boolean;
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
  // Dépenses et recettes créées par un import précédent : une autre ligne ne s'y rapproche pas.
  dejaImportes: Set<string> = new Set(),
): Map<string, Rapprochement> {
  const candidats: {
    cle: string;
    priorite: number;
    ecart: number;
    cible: string;
    r: Rapprochement;
  }[] = [];
  for (const l of lignes) {
    if (l.montantCents < 0) {
      for (const d of depenses) {
        const payee = d.etat === 'payee' && !dejaImportes.has(d.depenseId);
        if ((d.etat !== 'a_venir' && !payee) || d.payeur !== 'societe') continue;
        if (d.montantTtcCents !== -l.montantCents) continue;
        const ecart = ecartJours(l.date, d.date);
        if (ecart > FENETRE_SORTIE_JOURS) continue;
        candidats.push({
          cle: l.cle,
          priorite: payee ? 1 : 0,
          ecart,
          cible: `depense|${d.cle}`,
          r: {
            type: 'depense',
            id: d.depenseId,
            recurrente: d.recurrente,
            dejaCompte: payee,
            dateOrigine: d.cle.split('|')[1] ?? d.date,
            libelle: d.libelle,
            date: d.date,
            montantCents: d.montantTtcCents,
          },
        });
      }
    } else {
      for (const r of recettes) {
        const encaissee = r.etat === 'encaissee' && !dejaImportes.has(r.revenuId);
        if (r.etat !== 'prevue' && r.etat !== 'emise' && !encaissee) continue;
        const montant = r.montantHtCents + (r.tvaCents ?? 0);
        if (montant !== l.montantCents) continue;
        const ecart = ecartJours(l.date, encaissee ? (r.dateEncaissement ?? r.date) : r.date);
        if (ecart > (encaissee ? FENETRE_SORTIE_JOURS : FENETRE_ENTREE_JOURS)) continue;
        candidats.push({
          cle: l.cle,
          priorite: encaissee ? 1 : 0,
          ecart,
          cible: `recette|${r.cle}`,
          r: {
            type: 'recette',
            id: r.revenuId,
            recurrente: r.recurrente,
            dejaCompte: encaissee,
            dateOrigine: r.cle.split('|')[1] ?? r.date,
            libelle: r.libelle,
            date: r.date,
            montantCents: montant,
          },
        });
      }
    }
  }
  candidats.sort(
    (a, b) => a.priorite - b.priorite || a.ecart - b.ecart || a.cle.localeCompare(b.cle),
  );
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
  const dejaImportes = new Set(
    (
      await tx
        .select({ id: gestionImportCles.cibleId })
        .from(gestionImportCles)
        .where(
          and(
            eq(gestionImportCles.instanceId, currentInstance),
            eq(gestionImportCles.decision, 'importee'),
          ),
        )
    ).flatMap((r) => (r.id ? [r.id] : [])),
  );
  const rapprochements = proposerRapprochements(
    nouvelles,
    await occurrencesDepenses(tx, de, a),
    await occurrencesRevenus(tx, de, a),
    dejaImportes,
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
        raison: rapprochement.dejaCompte
          ? `Déjà comptée : « ${rapprochement.libelle} » du ${rapprochement.date}`
          : `Ressemble à « ${rapprochement.libelle} » prévu le ${rapprochement.date}`,
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

export type Decision = 'importer' | 'rapprocher' | 'ignorer';

// Applique les décisions de Marc. Le fichier est relu et ré-analysé : on ne fait jamais confiance à une
// liste de lignes venue du navigateur. Une ligne « nouvelle » sans décision est importée ; une ligne « à
// vérifier » sans décision reste de côté. Tout ou rien : une décision impossible annule l'ensemble.
export async function validerImport(
  tx: Executor,
  instanceId: string,
  f: Feuille,
  decisions: Record<string, Decision>,
): Promise<{ importees: number; rapprochees: number; ignorees: number }> {
  const { lignes } = await analyserImport(tx, f);
  const aTraiter = lignes.flatMap((l) => {
    if (l.issue === 'deja') return [];
    const d = decisions[l.cle] ?? (l.issue === 'nouvelle' ? 'importer' : null);
    if (!d) return [];
    if (d === 'rapprocher' && !l.rapprochement)
      throw new ImportInvalide(`Aucun rapprochement possible pour « ${l.libelle} » (${l.date}).`);
    return [{ l, d }];
  });

  const resultat = { importees: 0, rapprochees: 0, ignorees: 0 };
  for (const { l, d } of aTraiter) {
    let cible: { type: 'depense' | 'recette'; id: string } | null = null;
    if (d === 'ignorer') {
      resultat.ignorees += 1;
    } else if (d === 'importer') {
      if (l.sens === 'sortie') {
        const depense = await creerDepense(
          tx,
          instanceId,
          depenseSchema.parse({
            libelle: l.libelle,
            montantTtcCents: -l.montantCents,
            statut: 'reelle',
            dateDebut: l.date,
            affectations: [{ cible: 'simatis' }],
          }),
        );
        cible = { type: 'depense', id: depense.id };
      } else {
        // Le relevé donne le TTC encaissé sans le détail de la TVA : repris tel quel, TVA non renseignée.
        const revenu = await creerRevenu(
          tx,
          instanceId,
          revenuSchema.parse({
            libelle: l.libelle,
            type: 'autre',
            montantHtCents: l.montantCents,
            etat: 'encaissee',
            date: l.date,
            dateEncaissement: l.date,
          }),
        );
        cible = { type: 'recette', id: revenu.id };
      }
      resultat.importees += 1;
    } else {
      const r = l.rapprochement!;
      // Déjà payée ou encaissée : le relevé la confirme, on n'y touche pas.
      if (r.dejaCompte) {
        // rien à modifier
      } else if (r.type === 'depense') {
        if (r.recurrente)
          await modifierOccurrence(tx, instanceId, r.id, r.dateOrigine, {
            portee: 'cette',
            etat: 'payee',
            datePaiement: l.date,
            montantTtcCents: -l.montantCents,
          });
        else
          await modifierSerie(tx, r.id, {
            statut: 'reelle',
            dateDebut: l.date,
            montantTtcCents: -l.montantCents,
          });
      } else if (r.recurrente) {
        await modifierOccurrenceRevenu(tx, instanceId, r.id, r.dateOrigine, {
          portee: 'cette',
          etat: 'encaissee',
          dateEncaissement: l.date,
        });
      } else {
        await modifierRevenu(tx, r.id, { etat: 'encaissee', dateEncaissement: l.date });
      }
      cible = { type: r.type, id: r.id };
      resultat.rapprochees += 1;
    }
    await tx.insert(gestionImportCles).values({
      instanceId,
      cle: l.cle,
      decision: d === 'importer' ? 'importee' : d === 'rapprocher' ? 'rapprochee' : 'ignoree',
      cibleType: cible?.type ?? null,
      cibleId: cible?.id ?? null,
    });
  }
  return resultat;
}
