import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { SLUG } from '../instances/service.js';
import { jourDe } from '../pilotage/realisees.js';
import { occurrencesEntre, veille } from './recurrence.js';
import {
  CERTITUDES,
  ETATS_OCCURRENCE_REVENU,
  ETATS_REVENU,
  gestionDepenses,
  gestionRevenuExceptions,
  gestionRevenus,
  RECURRENCES,
  TYPES_REVENU,
} from './schema.js';

export class RevenuIntrouvable extends Error {
  constructor() {
    super('Recette introuvable');
  }
}
export class RevenuInvalide extends Error {}

const jour = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const revenuBase = z.object({
  libelle: z.string().trim().min(1).max(200),
  type: z.enum(TYPES_REVENU),
  mandat: z.string().regex(SLUG).nullish(),
  montantHtCents: z.number().int().min(0).max(100_000_000_00),
  etat: z.enum(ETATS_REVENU),
  date: jour,
  dateEncaissement: jour.nullish(),
  referenceFacture: z.string().trim().max(200).nullish(),
  tvaCents: z.number().int().min(0).nullish(),
  recurrence: z.enum(RECURRENCES),
  dateFin: jour.nullish(),
  certitude: z.enum(CERTITUDES),
  depenseId: z.uuid().nullish(),
});
// Les valeurs par défaut ne valent qu'à la création (même raison que pour les dépenses).
export const revenuSchema = revenuBase.extend({
  type: revenuBase.shape.type.default('commission'),
  etat: revenuBase.shape.etat.default('prevue'),
  recurrence: revenuBase.shape.recurrence.default('aucune'),
  certitude: revenuBase.shape.certitude.default('certaine'),
});
export const revenuPatchSchema = revenuBase.partial();
export type RevenuEntree = z.infer<typeof revenuSchema>;

export const occurrenceRevenuSchema = z.object({
  portee: z.enum(['cette', 'suivantes']).default('cette'),
  etat: z.enum(ETATS_OCCURRENCE_REVENU).optional(),
  dateEncaissement: jour.nullish(),
  montantHtCents: z.number().int().min(0).nullish(),
  referenceFacture: z.string().trim().max(200).nullish(),
  serie: revenuPatchSchema.optional(),
});

const visible = (id: string) =>
  and(
    eq(gestionRevenus.id, id),
    eq(gestionRevenus.instanceId, currentInstance),
    isNull(gestionRevenus.archiveeAt),
  );

// Une recette encaissée a une date d'encaissement ; une recette qui ne l'est pas n'en a pas.
function coherent(r: {
  etat: string;
  dateEncaissement?: string | null;
  recurrence?: string;
  dateFin?: string | null;
  date?: string;
}) {
  if (r.etat === 'encaissee' && !r.dateEncaissement)
    throw new RevenuInvalide("La date d'encaissement est requise");
  if (r.etat !== 'encaissee' && r.dateEncaissement)
    throw new RevenuInvalide("Une recette non encaissée n'a pas de date d'encaissement");
  if (r.dateFin && r.date && r.dateFin < r.date)
    throw new RevenuInvalide('La fin précède le début');
  if (r.recurrence && r.recurrence !== 'aucune' && r.etat !== 'prevue')
    throw new RevenuInvalide("L'état d'une série se règle échéance par échéance");
}

// Une refacturation vient d'une dépense de cette instance ; sinon la recette est refusée.
async function verifierDepense(tx: Executor, depenseId?: string | null) {
  if (!depenseId) return;
  const [d] = await tx
    .select({ id: gestionDepenses.id })
    .from(gestionDepenses)
    .where(
      and(
        eq(gestionDepenses.id, depenseId),
        eq(gestionDepenses.instanceId, currentInstance),
        isNull(gestionDepenses.archiveeAt),
      ),
    );
  if (!d) throw new RevenuInvalide('Dépense introuvable pour cette refacturation');
}

export async function creerRevenu(tx: Executor, instanceId: string, entree: RevenuEntree) {
  coherent(entree);
  await verifierDepense(tx, entree.depenseId);
  const [l] = await tx
    .insert(gestionRevenus)
    .values({ ...entree, instanceId })
    .returning();
  return l!;
}

export async function lireRevenu(tx: Executor, id: string) {
  const [l] = await tx.select().from(gestionRevenus).where(visible(id));
  if (!l) throw new RevenuIntrouvable();
  return l;
}

export async function modifierRevenu(tx: Executor, id: string, patch: Partial<RevenuEntree>) {
  const actuel = await lireRevenu(tx, id);
  coherent({
    etat: patch.etat ?? actuel.etat,
    dateEncaissement:
      patch.dateEncaissement === undefined ? actuel.dateEncaissement : patch.dateEncaissement,
    recurrence: patch.recurrence ?? actuel.recurrence,
    dateFin: patch.dateFin === undefined ? actuel.dateFin : patch.dateFin,
    date: patch.date ?? actuel.date,
  });
  await verifierDepense(tx, patch.depenseId);
  const [l] = await tx
    .update(gestionRevenus)
    .set({ ...patch, updatedAt: new Date() })
    .where(visible(id))
    .returning();
  return l!;
}

export async function archiverRevenu(tx: Executor, id: string) {
  await lireRevenu(tx, id);
  await tx
    .update(gestionRevenus)
    .set({ archiveeAt: new Date(), updatedAt: new Date() })
    .where(visible(id));
}

type Serie = typeof gestionRevenus.$inferSelect;
const serieDe = (s: Serie) => ({ recurrence: s.recurrence, debut: s.date, fin: s.dateFin });

// Cette échéance seule (facturée, encaissée, ignorée, montant réel) ou celle-ci et les suivantes
// (la série est coupée la veille et une nouvelle repart à `date`).
export async function modifierOccurrenceRevenu(
  tx: Executor,
  instanceId: string,
  id: string,
  date: string,
  entree: z.infer<typeof occurrenceRevenuSchema>,
) {
  const serie = await lireRevenu(tx, id);
  if (serie.recurrence === 'aucune') throw new RevenuInvalide("Cette recette n'est pas une série");
  if (!occurrencesEntre(serieDe(serie), date, date).includes(date))
    throw new RevenuInvalide("Cette échéance n'existe pas");

  if (entree.portee === 'suivantes') {
    if (date === serie.date) return modifierRevenu(tx, id, entree.serie ?? {});
    await tx
      .update(gestionRevenus)
      .set({ dateFin: veille(date), updatedAt: new Date() })
      .where(visible(id));
    return creerRevenu(tx, instanceId, {
      libelle: serie.libelle,
      type: serie.type,
      mandat: serie.mandat,
      montantHtCents: serie.montantHtCents,
      etat: 'prevue',
      recurrence: serie.recurrence,
      certitude: serie.certitude,
      depenseId: serie.depenseId,
      tvaCents: serie.tvaCents,
      ...entree.serie,
      date,
      dateFin: entree.serie?.dateFin ?? serie.dateFin,
    });
  }

  if (!entree.etat) throw new RevenuInvalide("État de l'échéance requis");
  if (entree.etat === 'encaissee' && !entree.dateEncaissement)
    throw new RevenuInvalide("La date d'encaissement est requise");
  const valeurs = {
    etat: entree.etat,
    dateEncaissement: entree.etat === 'encaissee' ? entree.dateEncaissement : null,
    montantHtCents: entree.montantHtCents ?? null,
    referenceFacture: entree.referenceFacture ?? null,
  };
  await tx
    .insert(gestionRevenuExceptions)
    .values({ instanceId, revenuId: id, dateOrigine: date, ...valeurs })
    .onConflictDoUpdate({
      target: [gestionRevenuExceptions.revenuId, gestionRevenuExceptions.dateOrigine],
      set: { ...valeurs, updatedAt: new Date() },
    });
  return serie;
}

export async function reinitialiserOccurrenceRevenu(tx: Executor, id: string, date: string) {
  await lireRevenu(tx, id);
  await tx
    .delete(gestionRevenuExceptions)
    .where(
      and(
        eq(gestionRevenuExceptions.revenuId, id),
        eq(gestionRevenuExceptions.dateOrigine, date),
        eq(gestionRevenuExceptions.instanceId, currentInstance),
      ),
    );
}

export type OccurrenceRevenu = {
  revenuId: string;
  cle: string;
  libelle: string;
  type: Serie['type'];
  mandat: string | null;
  certitude: Serie['certitude'];
  // Date d'échéance ; un encaissement compte à sa propre date (`dateEncaissement`).
  date: string;
  dateEncaissement: string | null;
  montantHtCents: number;
  etat: 'prevue' | 'emise' | 'encaissee' | 'ignoree';
  referenceFacture: string | null;
  recurrente: boolean;
  depenseId: string | null;
  // TVA de l'échéance, proportionnelle si le montant a été modifié ; null = non renseignée.
  tvaCents: number | null;
};

// Échéances de toutes les recettes entre deux jours (comme les occurrences de dépenses : calculées à
// la demande, seules les réalisations sont stockées).
export async function occurrencesRevenus(
  tx: Executor,
  de: string,
  a: string,
): Promise<OccurrenceRevenu[]> {
  const series = await tx
    .select()
    .from(gestionRevenus)
    .where(and(eq(gestionRevenus.instanceId, currentInstance), isNull(gestionRevenus.archiveeAt)));
  const exceptions = await tx
    .select()
    .from(gestionRevenuExceptions)
    .where(eq(gestionRevenuExceptions.instanceId, currentInstance));
  const parCle = new Map(exceptions.map((e) => [`${e.revenuId}|${e.dateOrigine}`, e]));

  const sorties: OccurrenceRevenu[] = [];
  for (const s of series) {
    for (const date of occurrencesEntre(serieDe(s), de, a)) {
      const cle = `${s.id}|${date}`;
      const ex = s.recurrence === 'aucune' ? undefined : parCle.get(cle);
      sorties.push({
        revenuId: s.id,
        cle,
        libelle: s.libelle,
        type: s.type,
        mandat: s.mandat,
        certitude: s.certitude,
        date,
        dateEncaissement:
          s.recurrence === 'aucune' ? s.dateEncaissement : (ex?.dateEncaissement ?? null),
        montantHtCents: ex?.montantHtCents ?? s.montantHtCents,
        etat: s.recurrence === 'aucune' ? s.etat : (ex?.etat ?? 'prevue'),
        referenceFacture:
          s.recurrence === 'aucune' ? s.referenceFacture : (ex?.referenceFacture ?? null),
        recurrente: s.recurrence !== 'aucune',
        depenseId: s.depenseId,
        tvaCents:
          s.tvaCents == null
            ? null
            : ex?.montantHtCents == null || s.montantHtCents === 0
              ? s.tvaCents
              : Math.round((s.tvaCents * ex.montantHtCents) / s.montantHtCents),
      });
    }
  }
  return sorties;
}

// Jour sous lequel une échéance compte dans les vues : l'encaissement à sa propre date.
export const jourDeCompte = (o: OccurrenceRevenu) =>
  o.etat === 'encaissee' && o.dateEncaissement ? o.dateEncaissement : o.date;

export type SyntheseRevenus = {
  mois: string;
  // CA en HT. Certain et incertain ne se mélangent jamais ; encaissé est à part.
  aEncaisserCertainCents: number;
  aEncaisserIncertainCents: number;
  encaisseCents: number;
  parMandat: {
    mandat: string | null;
    totalCents: number;
    aFacturerCents: number;
    parType: Partial<Record<Serie['type'], number>>;
  }[];
};

const finDeMois = (mois: string) => {
  const [a, m] = mois.split('-').map(Number) as [number, number];
  return `${mois}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

// Recettes d'un mois. Une échéance encaissée dans un autre mois que son échéance est cherchée sur
// 24 mois autour du mois demandé (ses deux dates comptent séparément).
export async function revenusDuMois(tx: Executor, mois: string) {
  const [a, m] = mois.split('-').map(Number) as [number, number];
  const debut = `${a - 1}-${String(m).padStart(2, '0')}-01`;
  const fin = finDeMois(`${a + 1}-${String(m).padStart(2, '0')}`);
  const duMois = (await occurrencesRevenus(tx, debut, fin))
    .filter((o) => o.etat !== 'ignoree' && jourDeCompte(o).startsWith(mois))
    .sort(
      (x, y) =>
        jourDeCompte(x).localeCompare(jourDeCompte(y)) || x.libelle.localeCompare(y.libelle),
    );
  const somme = (l: OccurrenceRevenu[]) => l.reduce((t, o) => t + o.montantHtCents, 0);
  const encaissees = duMois.filter((o) => o.etat === 'encaissee');
  const attendues = duMois.filter((o) => o.etat !== 'encaissee');
  const mandats = new Map<string | null, SyntheseRevenus['parMandat'][number]>();
  for (const o of duMois) {
    const ligne = mandats.get(o.mandat) ?? {
      mandat: o.mandat,
      totalCents: 0,
      aFacturerCents: 0,
      parType: {},
    };
    ligne.totalCents += o.montantHtCents;
    if (o.etat === 'prevue') ligne.aFacturerCents += o.montantHtCents;
    ligne.parType[o.type] = (ligne.parType[o.type] ?? 0) + o.montantHtCents;
    mandats.set(o.mandat, ligne);
  }
  const synthese: SyntheseRevenus = {
    mois,
    aEncaisserCertainCents: somme(attendues.filter((o) => o.certitude === 'certaine')),
    aEncaisserIncertainCents: somme(attendues.filter((o) => o.certitude !== 'certaine')),
    encaisseCents: somme(encaissees),
    parMandat: [...mandats.values()].sort((x, y) => y.totalCents - x.totalCents),
  };
  return { synthese, revenus: duMois };
}

// Recettes prévues à facturer d'ici `jusqua` : jamais une hypothèse, et rien qui soit déjà émis.
export async function facturesAEmettre(
  tx: Executor,
  jusqua: string,
  aujourdhui: string = jourDe(new Date()),
) {
  const [a, m, j] = aujourdhui.split('-').map(Number) as [number, number, number];
  const debut = `${a - 2}-${String(m).padStart(2, '0')}-${String(j).padStart(2, '0')}`;
  return (await occurrencesRevenus(tx, debut, jusqua))
    .filter((o) => o.etat === 'prevue' && o.certitude !== 'hypothese')
    .sort((x, y) => x.date.localeCompare(y.date) || x.libelle.localeCompare(y.libelle));
}

// Refacturations liées aux dépenses : par échéance de dépense (même date que la recette liée), ce qui
// est refacturable (prévu) et ce qui l'est réellement (facturé ou encaissé).
export async function refacturationsParEcheance(tx: Executor, de: string, a: string) {
  const liees = (await occurrencesRevenus(tx, de, a)).filter(
    (o) => o.depenseId && o.etat !== 'ignoree',
  );
  const parCle = new Map<string, { prevuCents: number; factureCents: number }>();
  for (const o of liees) {
    const cle = `${o.depenseId}|${o.date}`;
    const ligne = parCle.get(cle) ?? { prevuCents: 0, factureCents: 0 };
    ligne.prevuCents += o.montantHtCents;
    if (o.etat !== 'prevue') ligne.factureCents += o.montantHtCents;
    parCle.set(cle, ligne);
  }
  return parCle;
}

export async function refacturationsDeDepense(tx: Executor, depenseId: string) {
  return tx
    .select()
    .from(gestionRevenus)
    .where(
      and(
        eq(gestionRevenus.instanceId, currentInstance),
        eq(gestionRevenus.depenseId, depenseId),
        isNull(gestionRevenus.archiveeAt),
      ),
    );
}
