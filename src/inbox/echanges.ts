import { and, eq, lt } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor, Tx } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import {
  echangesAjout,
  type BrouillonSujet,
  type EchangeAjout,
  type MessageEchange,
  type StatutEchange,
} from './schema.js';
import { ajouterSujetTx, type SujetVue } from './service.js';

// Add conversation of the Inbox: the pilot writes what to add, the runner has Claude answer through
// the repondre_ajout tool (a question and/or a prepared entry), and the pilot adds the entry.

export class EchangeRefuse extends Error {}
export class EchangeInconnu extends Error {}

// What Claude may prepare: every type but « à valider », which only proposals create.
export const brouillonSchema = z.object({
  type: z.enum([
    'mail_a_repondre',
    'devis',
    'diagnostic',
    'compte_rendu',
    'brouillon_non_envoye',
    'autre',
  ]),
  titre: z.string().trim().min(1).max(300),
  resume: z
    .string()
    .trim()
    .max(5000)
    .nullish()
    .transform((r) => r || null),
  echeance: z.iso
    .datetime({ offset: true })
    .nullish()
    .transform((e) => e ?? null),
});

// Same delay as a routine request: past it, the runner is considered stopped.
export const DELAI_REPONSE_MS = 15 * 60_000;
export const MOTIF_SANS_REPONSE =
  "L'exécuteur n'a pas pris la demande en 15 minutes. Vérifiez qu'il tourne sur l'ordinateur, puis réécrivez votre message.";

const message = (de: MessageEchange['de'], texte: string): MessageEchange => ({
  de,
  texte,
  at: new Date().toISOString(),
});

export async function getEchange(tx: Tx, id: string): Promise<EchangeAjout> {
  const [row] = await tx
    .select()
    .from(echangesAjout)
    .where(and(eq(echangesAjout.instanceId, currentInstance), eq(echangesAjout.id, id)));
  if (!row) throw new EchangeInconnu('Échange introuvable dans cette instance');
  return row;
}

async function passer(
  tx: Tx,
  current: EchangeAjout,
  attendu: StatutEchange[],
  change: Partial<typeof echangesAjout.$inferInsert>,
): Promise<EchangeAjout> {
  if (!attendu.includes(current.statut)) {
    throw new EchangeRefuse(`Échange déjà ${current.statut.replace('_', ' ')}`);
  }
  const [row] = await tx
    .update(echangesAjout)
    .set({ ...change, updatedAt: new Date() })
    .where(eq(echangesAjout.id, current.id))
    .returning();
  return row ?? current;
}

export function ouvrirEchange(db: Executor, instance: Instance, texte: string) {
  return withInstance(db, instance.id, async (tx) => {
    const [row] = await tx
      .insert(echangesAjout)
      .values({ instanceId: currentInstance, messages: [message('pilote', texte)] })
      .returning();
    if (!row) throw new Error('Échange non créé');
    return row;
  });
}

export function lireEchange(db: Executor, instance: Instance, id: string) {
  return withInstance(db, instance.id, (tx) => getEchange(tx, id));
}

// The pilot answers Claude (or writes again after a failure): Claude is asked again.
export function repondrePilote(db: Executor, instance: Instance, id: string, texte: string) {
  return withInstance(db, instance.id, async (tx) => {
    const current = await getEchange(tx, id);
    return passer(tx, current, ['attente_pilote'], {
      statut: 'attente_claude',
      messages: [...current.messages, message('pilote', texte)],
      erreur: null,
      demandeAt: new Date(),
    });
  });
}

export function annulerEchange(db: Executor, instance: Instance, id: string) {
  return withInstance(db, instance.id, async (tx) =>
    passer(tx, await getEchange(tx, id), ['attente_claude', 'attente_pilote'], {
      statut: 'annule',
    }),
  );
}

// Adds the entry Claude prepared, as the pilot saw it.
export function ajouterDepuisEchange(
  db: Executor,
  instance: Instance,
  id: string,
): Promise<{ echange: EchangeAjout; sujet: SujetVue }> {
  return withInstance(db, instance.id, async (tx) => {
    const current = await getEchange(tx, id);
    // The status is checked first (the transaction rolls back on the missing entry).
    const echange = await passer(tx, current, ['attente_pilote'], { statut: 'ajoute' });
    const b = current.brouillon;
    if (!b) throw new EchangeRefuse("Claude n'a pas encore préparé d'entrée.");
    const sujet = await ajouterSujetTx(tx, instance, {
      type: b.type,
      titre: b.titre,
      resume: b.resume,
      echeance: b.echeance ? new Date(b.echeance) : null,
    });
    const [row] = await tx
      .update(echangesAjout)
      .set({ sujetId: sujet.id })
      .where(eq(echangesAjout.id, id))
      .returning();
    return { echange: row ?? echange, sujet };
  });
}

// Runner side: only a waiting conversation starts, so two runners never answer the same one.
export async function demarrerEchange(tx: Tx, id: string): Promise<EchangeAjout> {
  return passer(tx, await getEchange(tx, id), ['attente_claude'], { statut: 'en_cours' });
}

// Claude's answer (repondre_ajout). Without a new entry, the previous one stays.
export async function repondreClaude(
  tx: Tx,
  id: string,
  reponse: { message: string; brouillon?: BrouillonSujet | undefined },
): Promise<EchangeAjout> {
  const current = await getEchange(tx, id);
  return passer(tx, current, ['en_cours'], {
    statut: 'attente_pilote',
    messages: [...current.messages, message('claude', reponse.message)],
    ...(reponse.brouillon ? { brouillon: reponse.brouillon } : {}),
  });
}

// End of the runner's work: a conversation Claude left without an answer goes back to the pilot.
export async function finirEchange(tx: Tx, id: string, erreur: string): Promise<EchangeAjout> {
  const current = await getEchange(tx, id);
  if (current.statut !== 'en_cours') return current;
  return passer(tx, current, ['en_cours'], { statut: 'attente_pilote', erreur });
}

export async function abandonnerEchanges(tx: Tx, maintenant = new Date()): Promise<number> {
  const rows = await tx
    .update(echangesAjout)
    .set({ statut: 'attente_pilote', erreur: MOTIF_SANS_REPONSE, updatedAt: maintenant })
    .where(
      and(
        eq(echangesAjout.instanceId, currentInstance),
        eq(echangesAjout.statut, 'attente_claude'),
        lt(echangesAjout.demandeAt, new Date(maintenant.getTime() - DELAI_REPONSE_MS)),
      ),
    )
    .returning({ id: echangesAjout.id });
  return rows.length;
}
