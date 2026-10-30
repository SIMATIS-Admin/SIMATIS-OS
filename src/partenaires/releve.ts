import { and, eq, lt } from 'drizzle-orm';
import { relever, vider } from 'os-agents-relay';
import type { Database } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { listInstances } from '../instances/service.js';
import { loadInstanceSecrets } from '../secrets.js';
import { relaisVus } from './schema.js';
import {
  abandonner,
  clientPour,
  journaliserInvalide,
  SECRET_NOEUD,
  traiterEnveloppe,
  type RelaisDeps,
} from './service.js';
import { stockageInstance } from './stockage.js';

const GARDE_VUS_MS = 90 * 86_400_000;

export type BilanPartenaires = {
  slug: string;
  traitees: number;
  doublons: number;
  invalides: number;
  erreurs: number;
  envoyees: number;
  reportees: number;
  abandonnees: number;
};

// One pass for one instance: pick up the mailbox, then post what waits in the outbox.
export async function tourPartenaires(
  db: Database,
  instance: Instance,
  deps: RelaisDeps,
): Promise<BilanPartenaires> {
  const client = await clientPour(instance, deps);
  const stockage = stockageInstance(db, instance.id);
  const recu = await relever({
    client,
    stockage,
    traiter: (env) => traiterEnveloppe(db, instance, env),
    invalide: (env, problemes) => journaliserInvalide(db, instance, env, problemes),
  });
  const envoi = await vider({
    client,
    stockage,
    surAbandon: (s, raison) => abandonner(db, instance, s, raison),
  });
  await withInstance(db, instance.id, (tx) =>
    tx
      .delete(relaisVus)
      .where(
        and(
          eq(relaisVus.instanceId, currentInstance),
          lt(relaisVus.vuAt, new Date(Date.now() - GARDE_VUS_MS)),
        ),
      ),
  );
  return {
    slug: instance.slug,
    traitees: recu.traitees,
    doublons: recu.doublons,
    invalides: recu.invalides,
    erreurs: recu.erreurs.length,
    ...envoi,
  };
}

// Every active instance with a relay node. One failing instance does not stop the others.
export async function releverPartenaires(
  db: Database,
  deps: RelaisDeps & { onError?: (error: unknown, slug: string) => void },
): Promise<BilanPartenaires[]> {
  const bilans: BilanPartenaires[] = [];
  for (const instance of await listInstances(db)) {
    const secrets = await loadInstanceSecrets(deps.secretsDir, instance.slug);
    if (!secrets[SECRET_NOEUD]) continue;
    try {
      bilans.push(await tourPartenaires(db, instance, deps));
    } catch (error) {
      deps.onError?.(error, instance.slug);
    }
  }
  return bilans;
}

export function startRelevePartenaires(
  db: Database,
  deps: RelaisDeps & {
    tickMs?: number;
    onResult?: (r: BilanPartenaires[]) => void;
    onError?: (error: unknown, slug?: string) => void;
  },
): () => void {
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    releverPartenaires(db, deps)
      .then((r) => deps.onResult?.(r))
      .catch((error: unknown) => deps.onError?.(error))
      .finally(() => {
        running = false;
      });
  };
  const timer = setInterval(tick, deps.tickMs ?? 60_000);
  tick();
  return () => clearInterval(timer);
}
