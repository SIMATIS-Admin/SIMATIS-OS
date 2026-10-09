import { eq } from 'drizzle-orm';
import { configureConnexion } from '../connexions/service.js';
import type { Database, Tx } from '../db.js';
import { withInstance } from '../db/context.js';
import { METIER_TABLES } from '../db/metier-tables.js';
import { instances, type Instance } from '../instances/schema.js';
import { createInstance, SLUG } from '../instances/service.js';
import { logEvent } from '../journal/service.js';
import fixtures from './fixtures.json' with { type: 'json' };
import { loadDemoData } from './seed.js';

export class ProspectRefuse extends Error {}

const DEMO = fixtures.find((f) => f.type === 'prospect');

function slugify(nom: string): string {
  const base = nom
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return SLUG.test(base) ? base : 'prospect';
}

async function slugLibre(tx: Tx, nom: string): Promise<string> {
  const base = slugify(nom);
  for (let n = 1; ; n += 1) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const [taken] = await tx
      .select({ id: instances.id })
      .from(instances)
      .where(eq(instances.slug, slug));
    if (!taken) return slug;
  }
}

async function viderMetier(tx: Tx, instanceId: string) {
  // Explicit filter on top of Row-Level Security: the owner connection bypasses it.
  for (const table of METIER_TABLES) {
    await tx.delete(table).where(eq(table.instanceId, instanceId));
  }
}

// Fictive data and fictive tools: a demo never reaches a real CRM or mailbox.
async function chargerDemo(tx: Tx, instanceId: string) {
  if (!DEMO) throw new Error('Jeu de démonstration introuvable');
  await loadDemoData(tx, instanceId, DEMO);
  for (const kind of ['crm', 'messagerie', 'agenda'] as const) {
    await configureConnexion(tx, { kind, fournisseur: 'fake', reglages: { frequence: 'manuel' } });
  }
}

function requireProspect(instance: Instance) {
  if (instance.type !== 'prospect') {
    throw new ProspectRefuse('Seul un mandat prospect (démonstration) peut faire cette action.');
  }
}

export async function creerProspect(db: Database, { nom }: { nom: string }): Promise<Instance> {
  return db.transaction(async (tx) => {
    const instance = await createInstance(tx, {
      slug: await slugLibre(tx, nom),
      nom: nom.trim(),
      type: 'prospect',
      config: {
        sous: 'Mandat prospect fictif',
        couleur: DEMO?.config.couleur ?? '#E3A33B',
        modules: DEMO?.config.modules ?? [],
        ecrituresReelles: false,
      },
    });
    await withInstance(tx, instance.id, (itx) => chargerDemo(itx, instance.id));
    return instance;
  });
}

export async function reinitialiserDemo(db: Database, instance: Instance): Promise<void> {
  requireProspect(instance);
  await withInstance(db, instance.id, async (tx) => {
    await viderMetier(tx, instance.id);
    await chargerDemo(tx, instance.id);
    await logEvent(tx, { acteur: 'pilote', action: 'Démonstration réinitialisée' });
  });
}

// The prospect signs: fictive data goes, the instance becomes a mandate whose tools are still to
// be connected (Paramètres > Connexions).
export async function convertirProspect(
  db: Database,
  instance: Instance,
  { crm }: { crm: 'hubspot' | null },
): Promise<Instance> {
  requireProspect(instance);
  return withInstance(db, instance.id, async (tx) => {
    await viderMetier(tx, instance.id);
    const [row] = await tx
      .update(instances)
      .set({
        type: 'mandat',
        config: { ...instance.config, sous: 'Mandat', ecrituresReelles: false },
        updatedAt: new Date(),
      })
      .where(eq(instances.id, instance.id))
      .returning();
    const connexions = [
      { kind: 'crm', fournisseur: crm ?? 'natif' },
      { kind: 'messagerie', fournisseur: 'gmail' },
      { kind: 'agenda', fournisseur: 'google-agenda' },
    ] as const;
    for (const c of connexions) {
      await configureConnexion(tx, { ...c, etat: 'non_configuree' });
    }
    await logEvent(tx, {
      acteur: 'pilote',
      action: `Prospect transformé en mandat (données fictives supprimées${crm ? ', CRM HubSpot à brancher' : ''})`,
      niveau: 'L2',
    });
    if (!row) throw new Error('Instance non convertie');
    return row;
  });
}
