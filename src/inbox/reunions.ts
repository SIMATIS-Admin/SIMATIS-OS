import { and, eq, isNull } from 'drizzle-orm';
import { contacts, entreprises } from '../crm/schema.js';
import type { Tx } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { deposerSujet } from './depot.js';
import { reunionsWispr, sujets } from './schema.js';

// Au-delà, un transcript n'est plus une réunion : refus plutôt que de gonfler la base.
export const TRANSCRIPT_MAX = 500_000;

export class ReunionInvalide extends Error {}

export type DepotReunion = {
  wisprId: string;
  titre: string;
  debutAt: Date;
  participants: string[];
  resume: string | null;
  contactId?: string | null;
  entrepriseId?: string | null;
  // Entrée « compte rendu » déjà dans l'Inbox : la réunion s'y relie au lieu d'en créer une autre.
  sujetExistantId?: string | null;
};

const reunionPar = async (tx: Tx, wisprId: string) => {
  const [r] = await tx
    .select()
    .from(reunionsWispr)
    .where(and(eq(reunionsWispr.instanceId, currentInstance), eq(reunionsWispr.wisprId, wisprId)));
  return r;
};

// Dépose une réunion Wispr Flow : une seule entrée d'Inbox par réunion, pour toujours. Une réunion
// déjà vue ne change rien (le choix de Marc ne doit jamais être écrasé par un nouveau passage).
export async function deposerReunion(
  tx: Tx,
  r: DepotReunion,
): Promise<{ statut: 'cree' | 'existant' | 'relie'; sujetId: string }> {
  const vue = await reunionPar(tx, r.wisprId);
  if (vue) return { statut: 'existant', sujetId: vue.sujetId };

  let sujetId: string | null = null;
  if (r.sujetExistantId) {
    // Une entrée déjà traitée ne revient pas : on ne la relie pas.
    const [cible] = await tx
      .select({ id: sujets.id })
      .from(sujets)
      .where(
        and(
          eq(sujets.instanceId, currentInstance),
          eq(sujets.id, r.sujetExistantId),
          eq(sujets.type, 'compte_rendu'),
          eq(sujets.statut, 'a_traiter'),
        ),
      );
    sujetId = cible?.id ?? null;
  }
  const relie = sujetId !== null;
  if (!sujetId) {
    sujetId = (
      await deposerSujet(tx, {
        type: 'compte_rendu',
        titre: `Compte rendu : ${r.titre}`,
        resume: r.resume,
        origine: 'wispr',
        source: 'wispr',
        sourceId: r.wisprId,
        contactId: r.contactId ?? null,
        entrepriseId: r.entrepriseId ?? null,
      })
    ).id;
  }
  await tx.insert(reunionsWispr).values({
    instanceId: currentInstance,
    wisprId: r.wisprId,
    sujetId,
    titre: r.titre,
    debutAt: r.debutAt,
    participants: r.participants,
    resume: r.resume,
  });
  return { statut: relie ? 'relie' : 'cree', sujetId };
}

// Marc rattache la réunion et dit si elle est critique. Décocher « critique » supprime le transcript.
export async function attribuerReunion(
  tx: Tx,
  sujetId: string,
  a: { contactId: string | null; entrepriseId: string | null; critique: boolean },
): Promise<void> {
  const [reunion] = await tx
    .select({ id: reunionsWispr.id })
    .from(reunionsWispr)
    .where(and(eq(reunionsWispr.instanceId, currentInstance), eq(reunionsWispr.sujetId, sujetId)));
  if (!reunion) throw new ReunionInvalide('Réunion introuvable dans cette instance');
  // Les clés étrangères seules accepteraient un contact ou une entreprise d'une autre instance.
  for (const [table, id, nom] of [
    [contacts, a.contactId, 'Contact'],
    [entreprises, a.entrepriseId, 'Entreprise'],
  ] as const) {
    if (!id) continue;
    const [trouve] = await tx
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.instanceId, currentInstance), eq(table.id, id)));
    if (!trouve) throw new ReunionInvalide(`${nom} introuvable dans cette instance`);
  }
  const maintenant = new Date();
  await tx
    .update(sujets)
    .set({ contactId: a.contactId, entrepriseId: a.entrepriseId, updatedAt: maintenant })
    .where(and(eq(sujets.instanceId, currentInstance), eq(sujets.id, sujetId)));
  await tx
    .update(reunionsWispr)
    .set({
      critique: a.critique,
      ...(a.critique ? {} : { transcript: null, transcriptAt: null }),
      updatedAt: maintenant,
    })
    .where(eq(reunionsWispr.id, reunion.id));
}

// Réunions cochées « critique » dont la routine doit encore lire le transcript.
export async function reunionsATranscrire(tx: Tx): Promise<{ wisprId: string; sujetId: string }[]> {
  return tx
    .select({ wisprId: reunionsWispr.wisprId, sujetId: reunionsWispr.sujetId })
    .from(reunionsWispr)
    .where(
      and(
        eq(reunionsWispr.instanceId, currentInstance),
        eq(reunionsWispr.critique, true),
        isNull(reunionsWispr.transcript),
      ),
    );
}

export async function enregistrerTranscript(
  tx: Tx,
  wisprId: string,
  transcript: string,
): Promise<void> {
  const r = await reunionPar(tx, wisprId);
  if (!r) throw new ReunionInvalide('Réunion introuvable dans cette instance');
  if (!r.critique) throw new ReunionInvalide('Réunion non critique : pas de transcript conservé');
  if (transcript.length > TRANSCRIPT_MAX) throw new ReunionInvalide('Transcript trop long');
  await tx
    .update(reunionsWispr)
    .set({ transcript, transcriptAt: new Date(), updatedAt: new Date() })
    .where(eq(reunionsWispr.id, r.id));
}
