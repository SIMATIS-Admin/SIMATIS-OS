import { and, eq, inArray } from 'drizzle-orm';
import type { Database, Tx } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { listInstances } from '../instances/service.js';
import { logEvent } from '../journal/service.js';
import { canWriteReal } from '../propositions/service.js';
import { loadInstanceSecrets } from '../secrets.js';
import { connexions, type Connexion, type Frequence, type Kind, type Reglages } from './schema.js';
import type { Connector, SyncReport } from './types.js';

export type ConnexionDeps = { secretsDir: string; realWrites: boolean };

const connectors = new Map<string, Connector>();

export function registerConnector(connector: Connector): void {
  connectors.set(connector.fournisseur, connector);
}

export const FREQUENCES: Record<Frequence, number | null> = {
  '5min': 5 * 60_000,
  '15min': 15 * 60_000,
  '1h': 60 * 60_000,
  '1j': 24 * 60 * 60_000,
  manuel: null,
};

// The instance's own connection for this kind, or null: never a fallback to another instance.
export async function getConnector(
  tx: Tx,
  kind: Kind,
): Promise<{ connector: Connector; connexion: Connexion } | null> {
  const [connexion] = await tx
    .select()
    .from(connexions)
    .where(and(eq(connexions.instanceId, currentInstance), eq(connexions.kind, kind)));
  if (!connexion || connexion.etat === 'non_configuree') return null;
  const connector = connectors.get(connexion.fournisseur);
  return connector ? { connector, connexion } : null;
}

export async function configureConnexion(
  tx: Tx,
  input: { kind: Kind; fournisseur: string; reglages?: Reglages; etat?: Connexion['etat'] },
): Promise<Connexion> {
  const values = {
    fournisseur: input.fournisseur,
    reglages: input.reglages ?? {},
    etat: input.etat ?? ('ok' as const),
  };
  const [row] = await tx
    .insert(connexions)
    .values({
      instanceId: currentInstance,
      kind: input.kind,
      ...values,
    })
    .onConflictDoUpdate({
      target: [connexions.instanceId, connexions.kind],
      set: { ...values, updatedAt: new Date() },
    })
    .returning();
  if (!row) throw new Error('Connexion non enregistrée');
  await logEvent(tx, {
    acteur: 'pilote',
    action: `Connexion ${input.kind} réglée : ${input.fournisseur}`,
  });
  return row;
}

export function isDue(connexion: Connexion, now: Date): boolean {
  if (connexion.etat === 'non_configuree') return false;
  const every = FREQUENCES[connexion.reglages.frequence ?? '15min'];
  if (every === null) return false;
  const last = connexion.derniereTentative?.getTime();
  return last === undefined || now.getTime() - last >= every;
}

// One synchronization in its own transaction: if it fails, none of its writes are kept and the
// local copy stays as it was; the error is recorded on the connection.
export async function syncConnexion(
  db: Database,
  instance: Instance,
  kind: Kind,
  deps: ConnexionDeps,
  now = new Date(),
): Promise<SyncReport> {
  try {
    return await withInstance(db, instance.id, async (tx) => {
      const found = await getConnector(tx, kind);
      if (!found) throw new Error(`Connexion ${kind} non configurée pour ${instance.nom}`);
      const report = await found.connector.sync({
        instance,
        tx,
        secrets: await loadInstanceSecrets(deps.secretsDir, instance.slug),
        reglages: found.connexion.reglages,
        reel: canWriteReal(instance, deps.realWrites),
      });
      await tx
        .update(connexions)
        .set({
          etat: 'ok',
          derniereSynchro: now,
          derniereTentative: now,
          derniereErreur: null,
          updatedAt: now,
        })
        .where(eq(connexions.id, found.connexion.id));
      await logEvent(tx, {
        acteur: 'os',
        action: `Synchronisation ${kind} : ${report.lus} lus, ${report.crees} créés, ${report.maj} mis à jour`,
        niveau: 'L3',
        details: { ...report },
      });
      return report;
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await withInstance(db, instance.id, async (tx) => {
      await tx
        .update(connexions)
        .set({ etat: 'erreur', derniereTentative: now, derniereErreur: message, updatedAt: now })
        .where(
          and(
            eq(connexions.instanceId, currentInstance),
            eq(connexions.kind, kind),
            inArray(connexions.etat, ['ok', 'erreur']),
          ),
        );
      await logEvent(tx, {
        acteur: 'os',
        action: `Synchronisation ${kind} en échec`,
        details: { erreur: message },
      });
    });
    throw error;
  }
}

export async function syncNow(
  db: Database,
  slug: string,
  kind: Kind,
  deps: ConnexionDeps,
): Promise<SyncReport> {
  const instance = (await listInstances(db)).find((i) => i.slug === slug);
  if (!instance) throw new Error(`Instance inconnue ou archivée : ${slug}`);
  return syncConnexion(db, instance, kind, deps);
}

// One pass: synchronizes every connection that is due. After a long pause (a laptop asleep), a
// connection is synchronized once, not once per missed period.
export async function runSchedulerTick(
  db: Database,
  deps: ConnexionDeps,
  now = new Date(),
): Promise<number> {
  let runs = 0;
  for (const instance of await listInstances(db)) {
    const due = await withInstance(db, instance.id, async (tx) =>
      (await tx.select().from(connexions).where(eq(connexions.instanceId, currentInstance))).filter(
        (c) => isDue(c, now),
      ),
    );
    for (const connexion of due) {
      runs += 1;
      await syncConnexion(db, instance, connexion.kind, deps, now).catch(() => undefined);
    }
  }
  return runs;
}

export function startScheduler(
  db: Database,
  deps: ConnexionDeps & { tickMs?: number; onError?: (error: unknown) => void },
): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    runSchedulerTick(db, deps)
      .catch((error: unknown) => deps.onError?.(error))
      .finally(() => {
        running = false;
      });
  }, deps.tickMs ?? 60_000);
  return () => clearInterval(timer);
}
