import { and, eq } from 'drizzle-orm';
import type { Stockage, TypeEnveloppe } from 'os-agents-relay';
import type { Database, Tx } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import { relaisSorties, relaisVus } from './schema.js';

type Run = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

export async function marquerVu(tx: Tx, enveloppeId: string): Promise<void> {
  await tx
    .insert(relaisVus)
    .values({ instanceId: currentInstance, enveloppeId })
    .onConflictDoNothing({ target: [relaisVus.instanceId, relaisVus.enveloppeId] });
}

const sortie = (id: string) =>
  and(eq(relaisSorties.instanceId, currentInstance), eq(relaisSorties.id, id));

// The kit's storage on Postgres. Each call runs in its own instance transaction, except when built
// on an open transaction (stockageTx): then a queued envelope commits with the business change.
function stockageRelais(run: Run): Stockage {
  return {
    dejaVu: (id) =>
      run(async (tx) => {
        const [vu] = await tx
          .select({ id: relaisVus.id })
          .from(relaisVus)
          .where(and(eq(relaisVus.instanceId, currentInstance), eq(relaisVus.enveloppeId, id)));
        return Boolean(vu);
      }),
    marquerVu: (id) => run((tx) => marquerVu(tx, id)),
    ajouterSortie: (s) =>
      run(async (tx) => {
        await tx.insert(relaisSorties).values({
          id: s.id,
          instanceId: currentInstance,
          connexionId: s.connexion,
          type: s.type,
          corps: s.corps,
          creeLe: new Date(s.cree_le),
          prochainEssai: s.prochain_essai ? new Date(s.prochain_essai) : null,
        });
      }),
    sorties: () =>
      run(async (tx) => {
        const rows = await tx
          .select()
          .from(relaisSorties)
          .where(eq(relaisSorties.instanceId, currentInstance));
        return rows.map((r) => ({
          id: r.id,
          connexion: r.connexionId,
          type: r.type as TypeEnveloppe,
          corps: r.corps,
          cree_le: r.creeLe.toISOString(),
          prochain_essai: r.prochainEssai?.toISOString() ?? null,
        }));
      }),
    retirerSortie: (id) =>
      run(async (tx) => {
        await tx.delete(relaisSorties).where(sortie(id));
      }),
    reporterSortie: (id, prochainEssai) =>
      run(async (tx) => {
        await tx
          .update(relaisSorties)
          .set({ prochainEssai: new Date(prochainEssai), updatedAt: new Date() })
          .where(sortie(id));
      }),
  };
}

export const stockageInstance = (db: Database, instanceId: string): Stockage =>
  stockageRelais((fn) => withInstance(db, instanceId, fn));

export const stockageTx = (tx: Tx): Stockage => stockageRelais((fn) => fn(tx));
