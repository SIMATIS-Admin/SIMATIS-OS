import { and, desc, eq, gte } from 'drizzle-orm';
import { zoned } from '../connecteurs/google/creneaux.js';
import type { Database, Tx } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import { listInstances } from '../instances/service.js';
import { jourDe } from '../pilotage/realisees.js';
import { paramsOf } from './params.js';
import { executions, type CleRoutine } from './schema.js';
import { DejaEnCours, demanderExecution, listerRoutines } from './service.js';

const FUSEAU = 'Europe/Paris';
const PLANIFIE = 'planification';

const hhmm = (heure: string) => {
  const [h, m] = heure.split('h');
  return `${(h ?? '0').padStart(2, '0')}:${(m || '00').padStart(2, '0')}`;
};
// 1 = Monday … 7 = Sunday, in Paris.
const jourSemaine = (jour: string) => {
  const d = new Date(`${jour}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
};

// Time of today's scheduled run (Paris), or null when the routine does not run today.
export function heurePrevue(
  cle: CleRoutine,
  params: Record<string, unknown>,
  jour: string,
): Date | null {
  const j = jourSemaine(jour);
  if (cle === 'quotidienne') {
    const p = paramsOf('quotidienne', params);
    const ok = p.jours === 'Tous les jours' || (p.jours === 'Du lundi au jeudi' ? j <= 4 : j <= 5);
    return ok ? zoned(jour, hhmm(p.heure), FUSEAU) : null;
  }
  if (cle === 'hebdo') {
    const p = paramsOf('hebdo', params);
    return j === (p.jour === 'Lundi' ? 1 : 5) ? zoned(jour, hhmm(p.heure), FUSEAU) : null;
  }
  if (cle === 'nettoyage') {
    const p = paramsOf('nettoyage', params);
    return p.declenchement === 'Chaque jour à 18h00' ? zoned(jour, '18:00', FUSEAU) : null;
  }
  // « Sur événement » is triggered by events, not by the clock.
  return null;
}

// « Après chaque envoi de relances »: once today's daily run has ended, the cleanup follows once.
async function nettoyerApresRelance(tx: Tx, debutJour: Date): Promise<number> {
  const nettoyage = (await listerRoutines(tx)).find((r) => r.cle === 'nettoyage');
  if (
    !nettoyage?.actif ||
    paramsOf('nettoyage', nettoyage.params).declenchement !== 'Après chaque envoi de relances'
  ) {
    return 0;
  }
  const [relance] = await tx
    .select({ fin: executions.fin })
    .from(executions)
    .where(
      and(
        eq(executions.instanceId, currentInstance),
        eq(executions.routine, 'quotidienne'),
        eq(executions.statut, 'terminee'),
        gte(executions.fin, debutJour),
      ),
    )
    .orderBy(desc(executions.fin))
    .limit(1);
  if (!relance?.fin) return 0;
  const [suite] = await tx
    .select({ id: executions.id })
    .from(executions)
    .where(
      and(
        eq(executions.instanceId, currentInstance),
        eq(executions.routine, 'nettoyage'),
        gte(executions.createdAt, relance.fin),
      ),
    );
  if (suite) return 0;
  try {
    await demanderExecution(tx, 'nettoyage', PLANIFIE);
    return 1;
  } catch (error) {
    if (error instanceof DejaEnCours) return 0;
    throw error;
  }
}

// Creates the requests whose time has come. A run missed while the computer was off is caught up
// once, never more than one per routine and day.
export async function planifier(db: Database, maintenant = new Date()): Promise<number> {
  const jour = jourDe(maintenant, FUSEAU);
  const debutJour = zoned(jour, '00:00', FUSEAU);
  let creees = 0;
  for (const instance of await listInstances(db)) {
    // Demo instances only run on demand.
    if (instance.type === 'prospect') continue;
    creees += await withInstance(db, instance.id, async (tx) => {
      let n = 0;
      for (const r of await listerRoutines(tx)) {
        const prevue = heurePrevue(r.cle, r.params, jour);
        if (!r.actif || !prevue || maintenant < prevue) continue;
        const [deja] = await tx
          .select({ id: executions.id })
          .from(executions)
          .where(
            and(
              eq(executions.instanceId, currentInstance),
              eq(executions.routine, r.cle),
              eq(executions.demandePar, PLANIFIE),
              gte(executions.createdAt, debutJour),
            ),
          );
        if (deja) continue;
        try {
          await demanderExecution(tx, r.cle, PLANIFIE);
          n += 1;
        } catch (error) {
          if (!(error instanceof DejaEnCours)) throw error;
        }
      }
      n += await nettoyerApresRelance(tx, debutJour);
      return n;
    });
  }
  return creees;
}

export function startPlanification(
  db: Database,
  { everyMs = 60_000, onError }: { everyMs?: number; onError: (err: unknown) => void },
): () => void {
  const timer = setInterval(() => {
    planifier(db).catch(onError);
  }, everyMs);
  return () => clearInterval(timer);
}
