import { and, desc, eq, sql } from 'drizzle-orm';
import type { Executor } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import { entreprises } from '../crm/schema.js';
import type { Instance } from '../instances/schema.js';
import { ateliersStrategie, type Atelier, type EtatBrut } from './schema.js';

export class AtelierIndisponible extends Error {}
export class AtelierIntrouvable extends Error {
  constructor() {
    super('Atelier introuvable dans cet espace');
  }
}
export class EntrepriseIntrouvable extends Error {
  constructor() {
    super('Entreprise introuvable dans cet espace');
  }
}

export type AtelierListe = Omit<Atelier, 'etat'> & { nbActions: number };

// L'atelier est une brique de l'espace SIMATIS, activée par module (comme le devis).
export const atelierActif = (instance: Instance) =>
  instance.type === 'propre' && (instance.config.modules ?? []).includes('atelier');

const verifier = (instance: Instance) => {
  if (!atelierActif(instance))
    throw new AtelierIndisponible("L'atelier stratégique n'est pas activé dans cet espace.");
};

const ETAT_VIDE: EtatBrut = { v: 1, step: 0 };

export async function listAteliers(db: Executor, instance: Instance): Promise<AtelierListe[]> {
  verifier(instance);
  return withInstance(db, instance.id, async (tx) => {
    const lignes = await tx
      .select()
      .from(ateliersStrategie)
      .where(eq(ateliersStrategie.instanceId, instance.id))
      .orderBy(desc(ateliersStrategie.updatedAt));
    return lignes.map(({ etat, ...reste }) => ({
      ...reste,
      nbActions: Array.isArray(etat.actions) ? etat.actions.length : 0,
    }));
  });
}

export async function getAtelier(db: Executor, instance: Instance, id: string): Promise<Atelier> {
  verifier(instance);
  return withInstance(db, instance.id, async (tx) => {
    const [ligne] = await tx
      .select()
      .from(ateliersStrategie)
      .where(and(eq(ateliersStrategie.id, id), eq(ateliersStrategie.instanceId, instance.id)));
    if (!ligne) throw new AtelierIntrouvable();
    return ligne;
  });
}

export async function createAtelier(
  db: Executor,
  instance: Instance,
  input: { entrepriseId: string; titre: string; etat?: EtatBrut },
): Promise<Atelier> {
  verifier(instance);
  return withInstance(db, instance.id, async (tx) => {
    // Une entreprise d'une autre instance est invisible ici (RLS) : elle n'est donc pas trouvée.
    const [entreprise] = await tx
      .select({ id: entreprises.id })
      .from(entreprises)
      .where(
        and(eq(entreprises.instanceId, currentInstance), eq(entreprises.id, input.entrepriseId)),
      );
    if (!entreprise) throw new EntrepriseIntrouvable();
    const etat = input.etat ?? ETAT_VIDE;
    const [ligne] = await tx
      .insert(ateliersStrategie)
      .values({
        instanceId: instance.id,
        entrepriseId: input.entrepriseId,
        titre: input.titre.trim(),
        etape: etat.step + 1,
        etapeMax: etat.step + 1,
        etat,
      })
      .returning();
    return ligne!;
  });
}

export async function updateAtelier(
  db: Executor,
  instance: Instance,
  id: string,
  patch: { titre?: string; etat?: EtatBrut },
): Promise<Atelier> {
  verifier(instance);
  return withInstance(db, instance.id, async (tx) => {
    const [ligne] = await tx
      .update(ateliersStrategie)
      .set({
        ...(patch.titre === undefined ? {} : { titre: patch.titre.trim() }),
        ...(patch.etat === undefined
          ? {}
          : {
              etat: patch.etat,
              etape: patch.etat.step + 1,
              etapeMax: sql`greatest(${ateliersStrategie.etapeMax}, ${patch.etat.step + 1})`,
            }),
        updatedAt: new Date(),
      })
      .where(and(eq(ateliersStrategie.id, id), eq(ateliersStrategie.instanceId, instance.id)))
      .returning();
    if (!ligne) throw new AtelierIntrouvable();
    return ligne;
  });
}

export async function deleteAtelier(db: Executor, instance: Instance, id: string): Promise<void> {
  verifier(instance);
  await withInstance(db, instance.id, async (tx) => {
    const supprimes = await tx
      .delete(ateliersStrategie)
      .where(and(eq(ateliersStrategie.id, id), eq(ateliersStrategie.instanceId, instance.id)))
      .returning({ id: ateliersStrategie.id });
    if (supprimes.length === 0) throw new AtelierIntrouvable();
  });
}
