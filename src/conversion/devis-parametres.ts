import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { DevisRefuse } from './devis-contenu.js';
import { devisClauses, devisModeles, devisReglages, type LigneModele } from './schema.js';

const COMPTEUR = /\{(N+)\}/;

// `{AAAA}` is the year, `{NNN}` the counter padded to as many digits as there are N. One of each,
// and never a number that reads as a version (« …-V2 »): versions are told apart by that suffix.
export const formatNumeroValide = (format: string) => {
  if (format.length === 0 || format.length > 40 || !/^[\w\-. {}]+$/.test(format)) return false;
  if ((format.match(/\{AAAA\}/g) ?? []).length > 1) return false;
  if ((format.match(/\{N+\}/g) ?? []).length !== 1) return false;
  return !/-V\d+$/i.test(formaterNumero(format, 2026, 1));
};

export const formaterNumero = (format: string, annee: number, compteur: number) =>
  format
    .replace('{AAAA}', String(annee))
    .replace(COMPTEUR, (_, n: string) => String(compteur).padStart(n.length, '0'));

export const reglagesDevisSchema = z.object({
  numerotation: z.string().max(40),
  mentions: z.string().max(2000),
  tvaPct: z.number().int().min(0).max(100),
  validiteJours: z.number().int().min(1).max(365),
  acomptePct: z.number().int().min(0).max(100),
});
export type Reglages = z.infer<typeof reglagesDevisSchema>;

export const clauseBibliothequeSchema = z.object({
  titre: z.string().trim().min(1).max(200),
  texte: z.string().max(4000),
  parDefaut: z.boolean(),
  ordre: z.number().int().min(0).max(10_000),
});
export type ClauseBibliotheque = z.infer<typeof clauseBibliothequeSchema>;

export const modeleSchema = z.object({
  nom: z.string().trim().min(1).max(200),
  contexte: z.string().max(4000),
  objectifs: z.string().max(4000),
  inclus: z.string().max(4000),
  exclu: z.string().max(4000),
  livrables: z.string().max(4000),
  duree: z.string().max(100),
  lignes: z
    .array(
      z.object({
        libelle: z.string().trim().max(300),
        unite: z.enum(['forfait', 'jour', 'mois', 'personne', 'heure']),
        quantite: z.number().int().min(1).max(10_000),
      }),
    )
    .max(50),
});
export type ModeleMission = z.infer<typeof modeleSchema>;

export const REGLAGES_PAR_DEFAUT: Reglages = {
  numerotation: 'DEV-{AAAA}-{NNN}',
  mentions: '',
  tvaPct: 20,
  validiteJours: 30,
  acomptePct: 0,
};

export async function lireParametres(db: Executor, instance: Instance) {
  return withInstance(db, instance.id, async (tx) => {
    const [r] = await tx
      .select()
      .from(devisReglages)
      .where(eq(devisReglages.instanceId, currentInstance));
    const clauses = await tx
      .select()
      .from(devisClauses)
      .where(eq(devisClauses.instanceId, currentInstance))
      .orderBy(asc(devisClauses.ordre), asc(devisClauses.createdAt));
    const modeles = await tx
      .select()
      .from(devisModeles)
      .where(eq(devisModeles.instanceId, currentInstance))
      .orderBy(asc(devisModeles.nom));
    const reglages: Reglages = r
      ? {
          numerotation: r.numerotation,
          mentions: r.mentions,
          tvaPct: r.tvaPct,
          validiteJours: r.validiteJours,
          acomptePct: r.acomptePct,
        }
      : REGLAGES_PAR_DEFAUT;
    return { reglages, clauses, modeles };
  });
}

export async function enregistrerReglages(db: Executor, instance: Instance, valeurs: Reglages) {
  const r = reglagesDevisSchema.parse(valeurs);
  if (!formatNumeroValide(r.numerotation))
    throw new DevisRefuse(
      'Format de numérotation invalide : il faut un compteur, par exemple DEV-{AAAA}-{NNN}',
    );
  return withInstance(db, instance.id, async (tx) => {
    await tx
      .insert(devisReglages)
      .values({ instanceId: currentInstance, ...r })
      .onConflictDoUpdate({
        target: devisReglages.instanceId,
        set: { ...r, updatedAt: new Date() },
      });
    return r;
  });
}

export async function creerClause(db: Executor, instance: Instance, v: ClauseBibliotheque) {
  const c = clauseBibliothequeSchema.parse(v);
  return withInstance(db, instance.id, async (tx) => {
    const [row] = await tx
      .insert(devisClauses)
      .values({ instanceId: currentInstance, ...c })
      .returning();
    if (!row) throw new Error('Clause non créée');
    return row;
  });
}

export async function modifierClause(
  db: Executor,
  instance: Instance,
  id: string,
  v: ClauseBibliotheque,
) {
  const c = clauseBibliothequeSchema.parse(v);
  return withInstance(db, instance.id, async (tx) => {
    const [row] = await tx
      .update(devisClauses)
      .set({ ...c, updatedAt: new Date() })
      .where(and(eq(devisClauses.instanceId, currentInstance), eq(devisClauses.id, id)))
      .returning();
    if (!row) throw new DevisRefuse('Clause introuvable');
    return row;
  });
}

export async function supprimerClause(db: Executor, instance: Instance, id: string) {
  return withInstance(db, instance.id, async (tx) => {
    await tx
      .delete(devisClauses)
      .where(and(eq(devisClauses.instanceId, currentInstance), eq(devisClauses.id, id)));
  });
}

export async function creerModele(db: Executor, instance: Instance, v: ModeleMission) {
  const m = modeleSchema.parse(v);
  return withInstance(db, instance.id, async (tx) => {
    const [row] = await tx
      .insert(devisModeles)
      .values({ instanceId: currentInstance, ...m, lignes: m.lignes as LigneModele[] })
      .returning();
    if (!row) throw new Error('Modèle non créé');
    return row;
  });
}

export async function modifierModele(
  db: Executor,
  instance: Instance,
  id: string,
  v: ModeleMission,
) {
  const m = modeleSchema.parse(v);
  return withInstance(db, instance.id, async (tx) => {
    const [row] = await tx
      .update(devisModeles)
      .set({ ...m, updatedAt: new Date() })
      .where(and(eq(devisModeles.instanceId, currentInstance), eq(devisModeles.id, id)))
      .returning();
    if (!row) throw new DevisRefuse('Modèle introuvable');
    return row;
  });
}

export async function supprimerModele(db: Executor, instance: Instance, id: string) {
  return withInstance(db, instance.id, async (tx) => {
    await tx
      .delete(devisModeles)
      .where(and(eq(devisModeles.instanceId, currentInstance), eq(devisModeles.id, id)));
  });
}
