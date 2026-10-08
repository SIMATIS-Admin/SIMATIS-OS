import { and, eq } from 'drizzle-orm';
import type { Database } from '../db.js';
import { instances, type Instance } from './schema.js';

const TYPE_ORDER = { propre: 0, mandat: 1, prospect: 2 } as const;

export async function listInstances(db: Database): Promise<Instance[]> {
  const rows = await db.select().from(instances).where(eq(instances.statut, 'actif'));
  return rows.sort(
    (a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.nom.localeCompare(b.nom, 'fr'),
  );
}

export async function getInstanceBySlug(db: Database, slug: string): Promise<Instance | null> {
  const [row] = await db
    .select()
    .from(instances)
    .where(and(eq(instances.slug, slug), eq(instances.statut, 'actif')));
  return row ?? null;
}
