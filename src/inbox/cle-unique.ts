import { and, eq } from 'drizzle-orm';
import type { Executor } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { listInstances } from '../instances/service.js';
import { sujets } from './schema.js';

// Un même événement d'agenda ou un même fil de messagerie est vu depuis Mon activité et depuis chaque
// mandat : la clé d'un sujet n'est unique que dans son espace. Cette lecture dit si un AUTRE espace
// du pilote (Mon activité ou un mandat) a déjà un sujet avec cette clé, quel que soit son statut,
// pour ne jamais en déposer une seconde. Une démo reste à part : elle n'a ni voisin ni lecture.
export async function cleDejaDansUnAutreEspace(
  db: Executor,
  instance: Instance,
  source: string,
  sourceId: string,
): Promise<boolean> {
  if (instance.type === 'prospect') return false;
  const voisins = (await listInstances(db)).filter(
    (i) => i.id !== instance.id && (i.type === 'propre' || i.type === 'mandat'),
  );
  for (const voisin of voisins) {
    const trouve = await withInstance(db, voisin.id, async (tx) => {
      const [ligne] = await tx
        .select({ id: sujets.id })
        .from(sujets)
        .where(
          and(
            eq(sujets.instanceId, currentInstance),
            eq(sujets.source, source),
            eq(sujets.sourceId, sourceId),
          ),
        )
        .limit(1);
      return ligne !== undefined;
    });
    if (trouve) return true;
  }
  return false;
}
