import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Tx } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { logEvent } from '../journal/service.js';
import { CLES, paramsOf, paramsSchemas, ROUTINES } from './params.js';
import {
  executions,
  routines,
  type CleRoutine,
  type Execution,
  type Rapport,
  type Routine,
} from './schema.js';

export class DejaEnCours extends Error {}
export class RoutineInconnue extends Error {}

// Raised by a tool that needs a missing connection: the run stops there and is marked failed.
export class RoutineArretee extends Error {
  constructor(
    message: string,
    readonly executionId: string | null,
  ) {
    super(message);
  }
}

const isCle = (cle: string): cle is CleRoutine => (CLES as string[]).includes(cle);
export function cleOf(cle: string): CleRoutine {
  if (!isCle(cle)) throw new RoutineInconnue(`Routine inconnue : ${cle}`);
  return cle;
}

// The instance's routines, created with their defaults the first time they are read.
export async function listerRoutines(tx: Tx): Promise<Routine[]> {
  await tx
    .insert(routines)
    .values(
      ROUTINES.map((r) => ({
        instanceId: currentInstance,
        cle: r.cle,
        skill: r.skill,
        params: paramsOf(r.cle, {}),
      })),
    )
    .onConflictDoNothing();
  const rows = await tx.select().from(routines).where(eq(routines.instanceId, currentInstance));
  return CLES.map((cle) => rows.find((r) => r.cle === cle)).filter((r): r is Routine => !!r);
}

export async function getRoutine(tx: Tx, cle: CleRoutine): Promise<Routine> {
  const routine = (await listerRoutines(tx)).find((r) => r.cle === cle);
  if (!routine) throw new RoutineInconnue(`Routine inconnue : ${cle}`);
  return routine;
}

// Settings are checked against their bounds (e.g. quotidienne.max: 1 to 50) before being saved.
export async function modifierRoutine(
  tx: Tx,
  cle: CleRoutine,
  change: { actif?: boolean; params?: Record<string, unknown> },
): Promise<Routine> {
  const current = await getRoutine(tx, cle);
  const params = change.params
    ? paramsSchemas[cle].parse({ ...paramsOf(cle, current.params), ...change.params })
    : current.params;
  const [row] = await tx
    .update(routines)
    .set({ actif: change.actif ?? current.actif, params, updatedAt: new Date() })
    .where(eq(routines.id, current.id))
    .returning();
  const nom = ROUTINES.find((r) => r.cle === cle)?.nom ?? cle;
  await logEvent(tx, {
    acteur: 'pilote',
    action:
      change.actif === undefined
        ? `Réglages modifiés : ${nom}`
        : `Routine ${change.actif ? 'activée' : 'mise en pause'} : ${nom}`,
    niveau: 'L2',
  });
  return row ?? current;
}

// Vigilance 5: a second request while a run is open is refused (also enforced by a unique index).
export async function demanderExecution(tx: Tx, cle: CleRoutine, par: string): Promise<Execution> {
  const routine = await getRoutine(tx, cle);
  if (!routine.actif) throw new DejaEnCours('Routine en pause : activez-la pour la lancer.');
  const [ouverte] = await tx
    .select({ id: executions.id })
    .from(executions)
    .where(
      and(
        eq(executions.instanceId, currentInstance),
        eq(executions.routine, cle),
        inArray(executions.statut, ['demandee', 'en_cours']),
      ),
    );
  if (ouverte) throw new DejaEnCours('Une exécution de cette routine est déjà en cours.');
  const [row] = await tx
    .insert(executions)
    .values({ instanceId: currentInstance, routine: cle, demandePar: par })
    .returning();
  if (!row) throw new Error('Exécution non créée');
  await logEvent(tx, {
    acteur: par,
    action: `Exécution demandée : ${ROUTINES.find((r) => r.cle === cle)?.nom ?? cle}`,
  });
  return row;
}

export async function getExecution(tx: Tx, id: string): Promise<Execution> {
  const [row] = await tx
    .select()
    .from(executions)
    .where(and(eq(executions.instanceId, currentInstance), eq(executions.id, id)));
  if (!row) throw new RoutineInconnue('Exécution introuvable dans cette instance');
  return row;
}

export async function dernieresExecutions(tx: Tx) {
  const rows = await tx
    .select()
    .from(executions)
    .where(eq(executions.instanceId, currentInstance))
    .orderBy(desc(executions.createdAt))
    .limit(40);
  return CLES.map((cle) => ({ cle, derniere: rows.find((r) => r.routine === cle) ?? null }));
}

// Only a requested run starts: two runners never both start the same one.
export async function demarrerExecution(tx: Tx, id: string): Promise<Execution> {
  const current = await getExecution(tx, id);
  if (current.statut !== 'demandee') throw new DejaEnCours(`Exécution déjà ${current.statut}`);
  const [row] = await tx
    .update(executions)
    .set({ statut: 'en_cours', debut: new Date(), updatedAt: new Date() })
    .where(eq(executions.id, id))
    .returning();
  return row ?? current;
}

async function ouverte(tx: Tx, id: string): Promise<Execution> {
  const current = await getExecution(tx, id);
  if (current.statut !== 'en_cours' && current.statut !== 'demandee') {
    throw new RoutineInconnue(`Exécution déjà ${current.statut}`);
  }
  return current;
}

export async function noterEtape(
  tx: Tx,
  id: string,
  etape: string,
  statut: 'en_cours' | 'fait' | 'echec',
): Promise<Execution> {
  const current = await ouverte(tx, id);
  const etapes = [
    ...current.etapes.filter((e) => e.etape !== etape),
    { etape, statut, at: new Date().toISOString() },
  ];
  const [row] = await tx
    .update(executions)
    .set({ etapes, updatedAt: new Date() })
    .where(eq(executions.id, id))
    .returning();
  return row ?? current;
}

export async function terminerExecution(
  tx: Tx,
  id: string,
  rapport: Rapport,
  par: string,
): Promise<Execution> {
  const current = await ouverte(tx, id);
  const statut = rapport.echec.length ? 'echouee' : 'terminee';
  const [row] = await tx
    .update(executions)
    .set({ statut, rapport, fin: new Date(), updatedAt: new Date() })
    .where(eq(executions.id, id))
    .returning();
  await logEvent(tx, {
    acteur: par,
    action: `Routine Claude exécutée : ${ROUTINES.find((r) => r.cle === current.routine)?.nom ?? current.routine}${statut === 'echouee' ? ' (arrêtée)' : ''}`,
    niveau: 'L3',
    details: { execution: id },
  });
  return row ?? current;
}

// Marks an open run as failed with this reason (connection missing, runner crash…).
export async function echouerExecution(tx: Tx, id: string, message: string, par: string) {
  const current = await getExecution(tx, id);
  if (current.statut !== 'en_cours' && current.statut !== 'demandee') return current;
  return terminerExecution(
    tx,
    id,
    {
      fait: current.etapes.filter((e) => e.statut === 'fait').map((e) => e.etape),
      attente: current.rapport?.attente ?? [],
      echec: [message],
    },
    par,
  );
}
