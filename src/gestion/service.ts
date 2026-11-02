import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from '../db.js';
import { SLUG } from '../instances/service.js';
import { jourDe } from '../pilotage/realisees.js';
import { currentInstance } from '../db/columns.js';
import { normaliserMensuel, occurrencesEntre, veille } from './recurrence.js';
import {
  gestionDepenseExceptions,
  gestionDepenses,
  PAYEURS,
  RECURRENCES,
  STATUTS_DEPENSE,
  type Affectation,
} from './schema.js';

export class DepenseIntrouvable extends Error {
  constructor() {
    super('Dépense introuvable');
  }
}
export class DepenseInvalide extends Error {}

const jour = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const affectation = z.object({
  cible: z.enum(['simatis', 'kairos', 'mandat']),
  mandat: z.string().regex(SLUG).optional(),
});

const depenseBase = z.object({
  libelle: z.string().trim().min(1).max(200),
  categorie: z.string().trim().max(80).nullish(),
  montantTtcCents: z.number().int().min(0).max(100_000_000_00),
  tvaCents: z.number().int().min(0).nullish(),
  statut: z.enum(STATUTS_DEPENSE),
  recurrence: z.enum(RECURRENCES),
  dateDebut: jour,
  dateFin: jour.nullish(),
  payeur: z.enum(PAYEURS),
  affectations: z.array(affectation).max(20),
  refacturable: z.boolean(),
  justificatif: z.string().trim().max(500).nullish(),
});
// Les valeurs par défaut ne valent qu'à la création : une modification partielle ne doit jamais les
// réappliquer (elle écraserait la récurrence ou le rattachement existants).
export const depenseSchema = depenseBase.extend({
  recurrence: depenseBase.shape.recurrence.default('aucune'),
  payeur: depenseBase.shape.payeur.default('societe'),
  affectations: depenseBase.shape.affectations.default([]),
  refacturable: depenseBase.shape.refacturable.default(false),
});
export const depensePatchSchema = depenseBase.partial();
export type DepenseEntree = z.infer<typeof depenseSchema>;

export const occurrenceSchema = z.object({
  portee: z.enum(['cette', 'suivantes']).default('cette'),
  etat: z.enum(['payee', 'ignoree']).optional(),
  datePaiement: jour.nullish(),
  montantTtcCents: z.number().int().min(0).nullish(),
  // Modifications de la série (portée « suivantes ») : libellé, montant, catégorie.
  serie: depensePatchSchema.optional(),
});

export type OccurrenceVue = {
  depenseId: string;
  cle: string;
  libelle: string;
  categorie: string | null;
  date: string;
  montantTtcCents: number;
  // payee = réalisée ; a_venir = prévue ; prevue/reelle = nature de la dépense.
  etat: 'payee' | 'a_venir' | 'ignoree';
  statut: 'reelle' | 'prevue';
  recurrente: boolean;
  payeur: 'societe' | 'associe';
  // TVA de l'échéance (proportionnelle si le montant réel diffère) ; null = non renseignée.
  tvaCents: number | null;
  affectations: Affectation[];
  refacturable: boolean;
  justificatif: string | null;
};

const verifierAffectations = (a: Affectation[]) => {
  for (const x of a) {
    if (x.cible === 'mandat' && !x.mandat)
      throw new DepenseInvalide('Un mandat doit être précisé pour ce rattachement');
  }
};
const verifierDates = (debut: string, fin?: string | null) => {
  if (fin && fin < debut) throw new DepenseInvalide('La fin précède le début');
};

export async function creerDepense(tx: Executor, instanceId: string, entree: DepenseEntree) {
  verifierAffectations(entree.affectations);
  verifierDates(entree.dateDebut, entree.dateFin);
  const [ligne] = await tx
    .insert(gestionDepenses)
    .values({ ...entree, instanceId })
    .returning();
  return ligne!;
}

const depenseVisible = (id: string) =>
  and(
    eq(gestionDepenses.id, id),
    eq(gestionDepenses.instanceId, currentInstance),
    isNull(gestionDepenses.archiveeAt),
  );

export async function lireDepense(tx: Executor, id: string) {
  const [d] = await tx.select().from(gestionDepenses).where(depenseVisible(id));
  if (!d) throw new DepenseIntrouvable();
  return d;
}

// Modifie toute la série (libellé, montant, rattachement…), passé compris.
export async function modifierSerie(tx: Executor, id: string, patch: Partial<DepenseEntree>) {
  const actuelle = await lireDepense(tx, id);
  const dateDebut = patch.dateDebut ?? actuelle.dateDebut;
  const dateFin = patch.dateFin === undefined ? actuelle.dateFin : patch.dateFin;
  verifierDates(dateDebut, dateFin);
  if (patch.affectations) verifierAffectations(patch.affectations);
  const [ligne] = await tx
    .update(gestionDepenses)
    .set({ ...patch, updatedAt: new Date() })
    .where(depenseVisible(id))
    .returning();
  return ligne!;
}

// Suppression douce : la dépense et ses réalisations restent en base.
export async function archiverDepense(tx: Executor, id: string) {
  await lireDepense(tx, id);
  await tx
    .update(gestionDepenses)
    .set({ archiveeAt: new Date(), updatedAt: new Date() })
    .where(depenseVisible(id));
}

// Cette occurrence seule (réalisation, ignorée, date ou montant réels) ou celle-ci et les suivantes
// (la série est coupée la veille et une nouvelle série repart à `date`).
export async function modifierOccurrence(
  tx: Executor,
  instanceId: string,
  id: string,
  date: string,
  entree: z.infer<typeof occurrenceSchema>,
) {
  const serie = await lireDepense(tx, id);
  if (!occurrencesEntre(serieDe(serie), date, date).includes(date))
    throw new DepenseInvalide("Cette occurrence n'existe pas");

  if (entree.portee === 'suivantes') {
    if (date === serie.dateDebut) return modifierSerie(tx, id, entree.serie ?? {});
    await tx
      .update(gestionDepenses)
      .set({ dateFin: veille(date), updatedAt: new Date() })
      .where(depenseVisible(id));
    const base = {
      libelle: serie.libelle,
      categorie: serie.categorie,
      montantTtcCents: serie.montantTtcCents,
      tvaCents: serie.tvaCents,
      statut: serie.statut,
      recurrence: serie.recurrence,
      payeur: serie.payeur,
      affectations: serie.affectations,
      refacturable: serie.refacturable,
      justificatif: serie.justificatif,
    };
    return creerDepense(tx, instanceId, {
      ...base,
      ...entree.serie,
      dateDebut: date,
      dateFin: entree.serie?.dateFin ?? serie.dateFin,
    });
  }

  if (!entree.etat) throw new DepenseInvalide("État de l'occurrence requis");
  await tx
    .insert(gestionDepenseExceptions)
    .values({
      instanceId,
      depenseId: id,
      dateOrigine: date,
      etat: entree.etat,
      datePaiement: entree.datePaiement ?? null,
      montantTtcCents: entree.montantTtcCents ?? null,
    })
    .onConflictDoUpdate({
      target: [gestionDepenseExceptions.depenseId, gestionDepenseExceptions.dateOrigine],
      set: {
        etat: entree.etat,
        datePaiement: entree.datePaiement ?? null,
        montantTtcCents: entree.montantTtcCents ?? null,
        updatedAt: new Date(),
      },
    });
  return serie;
}

// Retire la réalisation ou l'exception d'une occurrence : elle redevient celle de la série.
export async function reinitialiserOccurrence(tx: Executor, id: string, date: string) {
  await lireDepense(tx, id);
  await tx
    .delete(gestionDepenseExceptions)
    .where(
      and(
        eq(gestionDepenseExceptions.depenseId, id),
        eq(gestionDepenseExceptions.dateOrigine, date),
        eq(gestionDepenseExceptions.instanceId, currentInstance),
      ),
    );
}

type Serie = typeof gestionDepenses.$inferSelect;
const serieDe = (s: Serie) => ({ recurrence: s.recurrence, debut: s.dateDebut, fin: s.dateFin });

// Occurrences de toutes les dépenses entre deux jours. Une dépense `reelle` ponctuelle est payée ;
// une prévue l'est seulement si une réalisation l'a confirmée (jamais déduite de la date).
export async function occurrencesDepenses(
  tx: Executor,
  de: string,
  a: string,
  aujourdhui: string = jourDe(new Date()),
): Promise<OccurrenceVue[]> {
  const series = await tx
    .select()
    .from(gestionDepenses)
    .where(
      and(eq(gestionDepenses.instanceId, currentInstance), isNull(gestionDepenses.archiveeAt)),
    );
  const exceptions = await tx
    .select()
    .from(gestionDepenseExceptions)
    .where(eq(gestionDepenseExceptions.instanceId, currentInstance));
  const parCle = new Map(exceptions.map((e) => [`${e.depenseId}|${e.dateOrigine}`, e]));

  const sorties: OccurrenceVue[] = [];
  for (const s of series) {
    for (const date of occurrencesEntre(serieDe(s), de, a)) {
      const cle = `${s.id}|${date}`;
      const ex = parCle.get(cle);
      // « Déjà payée » vaut pour une dépense ponctuelle ; dans une série, seules les échéances passées.
      const payeeParDefaut =
        s.statut === 'reelle' && (s.recurrence === 'aucune' || date <= aujourdhui);
      const etat = ex?.etat ?? (payeeParDefaut ? 'payee' : 'a_venir');
      sorties.push({
        depenseId: s.id,
        cle,
        libelle: s.libelle,
        categorie: s.categorie,
        date: ex?.datePaiement ?? date,
        montantTtcCents: ex?.montantTtcCents ?? s.montantTtcCents,
        etat,
        statut: s.statut,
        recurrente: s.recurrence !== 'aucune',
        payeur: s.payeur,
        tvaCents:
          s.tvaCents == null
            ? null
            : ex?.montantTtcCents == null || s.montantTtcCents === 0
              ? s.tvaCents
              : Math.round((s.tvaCents * ex.montantTtcCents) / s.montantTtcCents),
        affectations: s.affectations,
        refacturable: s.refacturable,
        justificatif: s.justificatif,
      });
    }
  }
  return sorties.sort((x, y) => x.date.localeCompare(y.date) || x.libelle.localeCompare(y.libelle));
}

export type SyntheseMois = {
  mois: string;
  payeCents: number;
  aVenirCents: number;
  totalCents: number;
  parMois12: { mois: string; cents: number }[];
  recurrentMensuelCents: number;
};

const finDeMois = (mois: string) => {
  const [a, m] = mois.split('-').map(Number) as [number, number];
  return `${mois}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`;
};
export const moisSuivant = (mois: string, n = 1) => {
  const [a, m] = mois.split('-').map(Number) as [number, number];
  const i = a * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
};

// Chiffres du mois et effet sur les 12 mois suivants. Les occurrences ignorées ne comptent pas.
export async function syntheseDepenses(tx: Executor, mois: string): Promise<SyntheseMois> {
  const fin12 = finDeMois(moisSuivant(mois, 11));
  const toutes = (await occurrencesDepenses(tx, `${mois}-01`, fin12)).filter(
    (o) => o.etat !== 'ignoree',
  );
  const duMois = toutes.filter((o) => o.date.startsWith(mois));
  const somme = (l: OccurrenceVue[]) => l.reduce((t, o) => t + o.montantTtcCents, 0);
  const series = await tx
    .select()
    .from(gestionDepenses)
    .where(
      and(eq(gestionDepenses.instanceId, currentInstance), isNull(gestionDepenses.archiveeAt)),
    );
  const finMois = finDeMois(mois);
  return {
    mois,
    payeCents: somme(duMois.filter((o) => o.etat === 'payee')),
    aVenirCents: somme(duMois.filter((o) => o.etat === 'a_venir')),
    totalCents: somme(duMois),
    parMois12: Array.from({ length: 12 }, (_, k) => {
      const m = moisSuivant(mois, k);
      return { mois: m, cents: somme(toutes.filter((o) => o.date.startsWith(m))) };
    }),
    // Séries encore actives ce mois-ci, ramenées au mois.
    recurrentMensuelCents: series
      .filter((s) => s.dateDebut <= finMois && (!s.dateFin || s.dateFin >= `${mois}-01`))
      .reduce((t, s) => t + normaliserMensuel(s.montantTtcCents, s.recurrence), 0),
  };
}
