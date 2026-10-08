import { and, eq } from 'drizzle-orm';
import type { Executor } from '../db.js';
import { withInstance } from '../db/context.js';
import { METIER_TABLES } from '../db/metier-tables.js';
import { logEvent } from '../journal/service.js';
import { instances, type Instance, type InstanceConfig, type InstanceType } from './schema.js';

const TYPE_ORDER = { propre: 0, mandat: 1, prospect: 2 } as const;
const TYPES = Object.keys(TYPE_ORDER) as InstanceType[];

// Slugs end up in URLs and in secrets file names (secrets/instances/<slug>.env).
export const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

const byTypeThenName = (a: Instance, b: Instance) =>
  TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.nom.localeCompare(b.nom, 'fr');

export async function listInstances(
  db: Executor,
  { includeArchived = false } = {},
): Promise<Instance[]> {
  const rows = includeArchived
    ? await db.select().from(instances)
    : await db.select().from(instances).where(eq(instances.statut, 'actif'));
  return rows.sort(byTypeThenName);
}

export async function getInstanceBySlug(db: Executor, slug: string): Promise<Instance | null> {
  const [row] = await db
    .select()
    .from(instances)
    .where(and(eq(instances.slug, slug), eq(instances.statut, 'actif')));
  return row ?? null;
}

export async function createInstance(
  db: Executor,
  input: { slug: string; nom: string; type: InstanceType; config?: InstanceConfig },
): Promise<Instance> {
  if (!SLUG.test(input.slug)) {
    throw new Error(`Identifiant invalide : ${input.slug} (minuscules, chiffres et tirets)`);
  }
  if (!TYPES.includes(input.type)) throw new Error(`Type invalide : ${String(input.type)}`);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(instances)
      .values({ slug: input.slug, nom: input.nom, type: input.type, config: input.config ?? {} })
      .returning();
    if (!row) throw new Error(`Instance non créée : ${input.slug}`);
    await withInstance(tx, row.id, (itx) =>
      logEvent(itx, {
        acteur: 'systeme',
        action: `Instance créée : ${row.nom}`,
        details: { type: row.type },
      }),
    );
    return row;
  });
}

async function requireInstance(db: Executor, slug: string): Promise<Instance> {
  const [row] = await db.select().from(instances).where(eq(instances.slug, slug));
  if (!row) throw new Error(`Instance inconnue : ${slug}`);
  return row;
}

export async function archiveInstance(db: Executor, slug: string): Promise<Instance> {
  const instance = await requireInstance(db, slug);
  return withInstance(db, instance.id, async (tx) => {
    const [row] = await tx
      .update(instances)
      .set({ statut: 'archive', updatedAt: new Date() })
      .where(eq(instances.id, instance.id))
      .returning();
    await logEvent(tx, { acteur: 'systeme', action: 'Instance archivée' });
    return row ?? instance;
  });
}

// Deletes the instance's business rows, keeps its journal, and leaves the instance archived.
export async function purgeInstance(db: Executor, slug: string): Promise<Instance> {
  const instance = await requireInstance(db, slug);
  return withInstance(db, instance.id, async (tx) => {
    // Explicit filter: the owner connection used by the CLI bypasses Row-Level Security.
    for (const table of METIER_TABLES) {
      await tx.delete(table).where(eq(table.instanceId, instance.id));
    }
    const [row] = await tx
      .update(instances)
      .set({ statut: 'archive', updatedAt: new Date() })
      .where(eq(instances.id, instance.id))
      .returning();
    await logEvent(tx, {
      acteur: 'systeme',
      action: 'Instance purgée (données métier supprimées)',
    });
    return row ?? instance;
  });
}
