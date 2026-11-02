import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { SLUG } from '../instances/service.js';
import { ETATS_REVENU, gestionRevenus, TYPES_REVENU } from './schema.js';

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
});
// Les valeurs par défaut ne valent qu'à la création (même raison que pour les dépenses).
export const revenuSchema = revenuBase.extend({
  type: revenuBase.shape.type.default('commission'),
  etat: revenuBase.shape.etat.default('prevue'),
});
export const revenuPatchSchema = revenuBase.partial();
export type RevenuEntree = z.infer<typeof revenuSchema>;

const visible = (id: string) =>
  and(
    eq(gestionRevenus.id, id),
    eq(gestionRevenus.instanceId, currentInstance),
    isNull(gestionRevenus.archiveeAt),
  );

// Une recette encaissée a une date d'encaissement ; une recette qui ne l'est pas n'en a pas.
function coherent(r: { etat: string; dateEncaissement?: string | null }) {
  if (r.etat === 'encaissee' && !r.dateEncaissement)
    throw new RevenuInvalide("La date d'encaissement est requise");
  if (r.etat !== 'encaissee' && r.dateEncaissement)
    throw new RevenuInvalide("Une recette non encaissée n'a pas de date d'encaissement");
}

export async function creerRevenu(tx: Executor, instanceId: string, entree: RevenuEntree) {
  coherent(entree);
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
  });
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

export type SyntheseRevenus = {
  mois: string;
  // CA en HT : à encaisser (prévu ou facturé) et déjà encaissé, jamais mélangés.
  aEncaisserCents: number;
  encaisseCents: number;
};

// Recettes d'un mois : un revenu encaissé compte à sa date d'encaissement, les autres à leur date.
export async function revenusDuMois(tx: Executor, mois: string) {
  const lignes = await tx
    .select()
    .from(gestionRevenus)
    .where(and(eq(gestionRevenus.instanceId, currentInstance), isNull(gestionRevenus.archiveeAt)));
  const dateDe = (r: (typeof lignes)[number]) =>
    r.etat === 'encaissee' && r.dateEncaissement ? r.dateEncaissement : r.date;
  const duMois = lignes
    .filter((r) => dateDe(r).startsWith(mois))
    .sort((a, b) => dateDe(a).localeCompare(dateDe(b)) || a.libelle.localeCompare(b.libelle));
  const somme = (encaissee: boolean) =>
    duMois
      .filter((r) => (r.etat === 'encaissee') === encaissee)
      .reduce((t, r) => t + r.montantHtCents, 0);
  const synthese: SyntheseRevenus = {
    mois,
    aEncaisserCents: somme(false),
    encaisseCents: somme(true),
  };
  return { synthese, revenus: duMois };
}
