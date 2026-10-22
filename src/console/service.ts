import { and, eq, gte } from 'drizzle-orm';
import type { Executor } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { journal } from '../journal/schema.js';
import { executions, type Execution } from '../routines/schema.js';

export type NiveauConsole = 'ok' | 'info' | 'attention' | 'erreur';

export type LigneConsole = {
  id: string;
  at: string;
  source: 'journal' | 'routine';
  acteur: string;
  niveau: NiveauConsole;
  texte: string;
};

export type Console = { lignes: LigneConsole[]; enCours: boolean };

export const FENETRE_MS = 24 * 3_600_000;
const MAX_LIGNES = 300;

type LigneJournal = typeof journal.$inferSelect;

const enJournal = (e: LigneJournal): LigneConsole => ({
  id: `j${e.id}`,
  at: e.at.toISOString(),
  source: 'journal',
  acteur: e.acteur,
  niveau: 'info',
  texte: e.action,
});

// One run gives a line when it starts and, once closed, a line per point of its report: what was
// done, what waits for Marc, what failed — the same words as the Inbox header.
function enRoutine(x: Execution): LigneConsole[] {
  const base = { source: 'routine' as const, acteur: `routine:${x.routine}` };
  const lignes: LigneConsole[] = [
    {
      ...base,
      id: `x${x.id}:debut`,
      at: x.createdAt.toISOString(),
      niveau: 'info',
      texte: `Routine « ${x.routine} » demandée par ${x.demandePar}`,
    },
  ];
  if (x.statut === 'en_cours' && x.debut) {
    lignes.push({
      ...base,
      id: `x${x.id}:prise`,
      at: x.debut.toISOString(),
      niveau: 'info',
      texte: `Routine « ${x.routine} » : Claude travaille…`,
    });
  }
  const fin = x.fin ?? x.updatedAt;
  if (x.statut === 'terminee' || x.statut === 'echouee') {
    const ok = x.statut === 'terminee';
    lignes.push({
      ...base,
      id: `x${x.id}:fin`,
      at: fin.toISOString(),
      niveau: ok ? 'ok' : 'erreur',
      texte: `Routine « ${x.routine} » ${ok ? 'terminée' : 'échouée'}`,
    });
  }
  const points: [keyof NonNullable<Execution['rapport']>, NiveauConsole][] = [
    ['fait', 'ok'],
    ['attente', 'attention'],
    ['echec', 'erreur'],
  ];
  for (const [cle, niveau] of points) {
    (x.rapport?.[cle] ?? []).forEach((texte, i) =>
      lignes.push({ ...base, id: `x${x.id}:${cle}${i}`, at: fin.toISOString(), niveau, texte }),
    );
  }
  return lignes;
}

// Oldest first, like a terminal: the newest line sits at the bottom. The sort is stable, so the
// lines of one report keep their order (done, waiting, failed).
export function fusionnerConsole(evenements: LigneJournal[], runs: Execution[]): Console {
  const lignes = [...evenements.map(enJournal), ...runs.flatMap(enRoutine)]
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-MAX_LIGNES);
  return {
    lignes,
    enCours: runs.some((x) => x.statut === 'demandee' || x.statut === 'en_cours'),
  };
}

export async function lireConsole(tx: Executor, maintenant = new Date()): Promise<Console> {
  const depuis = new Date(maintenant.getTime() - FENETRE_MS);
  const evenements = await tx
    .select()
    .from(journal)
    .where(and(eq(journal.instanceId, currentInstance), gte(journal.at, depuis)));
  const runs = await tx
    .select()
    .from(executions)
    .where(and(eq(executions.instanceId, currentInstance), gte(executions.createdAt, depuis)));
  return fusionnerConsole(evenements, runs);
}
