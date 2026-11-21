import { and, eq } from 'drizzle-orm';
import { messagesDuLibelle } from '../connecteurs/google/google.js';
import { connexions } from '../connexions/schema.js';
import type { Database } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { listInstances } from '../instances/service.js';
import { loadInstanceSecrets } from '../secrets.js';
import { paramsOf } from '../routines/params.js';
import { DejaEnCours, demanderExecution, getRoutine } from '../routines/service.js';
import {
  actualiserLinkedin,
  compterMessagesALire,
  JOURS_LINKEDIN,
  LIBELLE_LINKEDIN,
} from './linkedin.js';

const FUSEAU = 'Europe/Paris';
// Deux passages par jour ouvré : un lien LinkedIn lu plus souvent n'apporterait rien au pilote.
export const HEURES_PASSAGES = [9, 14];
// Le passage de l'après-midi, qui a vu les messages de la matinée, demande aussi la lecture du
// texte sur LinkedIn : une fois par jour.
export const PASSAGE_LECTURE = 14;
const DECLENCHEMENT_QUOTIDIEN = 'Une fois par jour, si de nouveaux messages sont arrivés';

export class LinkedinIndisponible extends Error {}

// The passage the clock has reached: « 2026-10-05@14 » for 14h00 and after, « …@9 » from 9h00,
// nothing before 9h or on a weekend. A new value means a passage is due.
export function passageDu(maintenant: Date): string | null {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: FUSEAU,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
      weekday: 'short',
    })
      .formatToParts(maintenant)
      .map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  if (p.weekday === 'Sat' || p.weekday === 'Sun') return null;
  const heure = Number(p.hour);
  const atteint = HEURES_PASSAGES.filter((h) => h <= heure).at(-1);
  return atteint === undefined ? null : `${p.year}-${p.month}-${p.day}@${atteint}`;
}

// Reads the label of LinkedIn notifications in the instance's Gmail and files what is new in its
// Inbox. Only the pilot's own instance, and only a Gmail mailbox: the filter lives there.
export async function lireLinkedin(
  db: Database,
  instance: Instance,
  secretsDir: string,
  options: Parameters<typeof messagesDuLibelle>[3] = {},
): Promise<{ lues: number; nouveaux: number }> {
  if (instance.type !== 'propre') {
    throw new LinkedinIndisponible('Les messages LinkedIn ne sont lus que dans Mon activité.');
  }
  const [c] = await withInstance(db, instance.id, (tx) =>
    tx
      .select()
      .from(connexions)
      .where(and(eq(connexions.instanceId, currentInstance), eq(connexions.kind, 'messagerie'))),
  );
  if (!c || c.fournisseur !== 'gmail' || c.etat === 'non_configuree') {
    throw new LinkedinIndisponible("Aucune boîte Gmail n'est branchée.");
  }
  // The network read first: no transaction stays open while Google answers.
  const notifications = await messagesDuLibelle(
    { instance, secrets: await loadInstanceSecrets(secretsDir, instance.slug) },
    LIBELLE_LINKEDIN,
    JOURS_LINKEDIN,
    options,
  );
  return withInstance(db, instance.id, (tx) =>
    actualiserLinkedin(tx, () => Promise.resolve(notifications)),
  );
}

// Demande à l'exécuteur de lire sur LinkedIn le texte des messages dont seul l'aperçu est connu.
// Rien à lire, routine en pause ou réglée « à la demande » : aucune demande, LinkedIn reste fermé.
export async function demanderLectureLinkedin(
  db: Database,
  instance: Instance,
): Promise<'demandee' | 'rien' | 'refusee'> {
  return withInstance(db, instance.id, async (tx) => {
    if ((await compterMessagesALire(tx)) === 0) return 'rien';
    const routine = await getRoutine(tx, 'linkedin');
    const quotidien =
      paramsOf('linkedin', routine.params).declenchement === DECLENCHEMENT_QUOTIDIEN;
    if (!routine.actif || !quotidien) return 'refusee';
    try {
      await demanderExecution(tx, 'linkedin', 'planification');
      return 'demandee';
    } catch (error) {
      if (error instanceof DejaEnCours) return 'refusee';
      throw error;
    }
  });
}

// Every minute, checks whether a passage is due. A passage missed while the computer was off is
// made up at the next check; what has already been filed is never filed twice.
export function startPassagesLinkedin(
  db: Database,
  opts: {
    secretsDir: string;
    onResult?: (r: { slug: string; lues: number; nouveaux: number }) => void;
    onError: (err: unknown, slug: string) => void;
    everyMs?: number;
  },
): () => void {
  const faits = new Map<string, string>();
  const passer = async () => {
    const passage = passageDu(new Date());
    if (!passage) return;
    for (const instance of await listInstances(db)) {
      if (instance.type !== 'propre' || faits.get(instance.id) === passage) continue;
      faits.set(instance.id, passage);
      try {
        const r = await lireLinkedin(db, instance, opts.secretsDir);
        opts.onResult?.({ slug: instance.slug, ...r });
        if (passage.endsWith(`@${PASSAGE_LECTURE}`)) await demanderLectureLinkedin(db, instance);
      } catch (error) {
        // Without a Gmail mailbox there is nothing to read: not an error worth a warning.
        if (!(error instanceof LinkedinIndisponible)) opts.onError(error, instance.slug);
      }
    }
  };
  const timer = setInterval(() => {
    passer().catch((err: unknown) => opts.onError(err, ''));
  }, opts.everyMs ?? 60_000);
  return () => clearInterval(timer);
}
