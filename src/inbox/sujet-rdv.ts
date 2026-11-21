import { and, eq, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { rendezVous } from '../crm/schema.js';
import type { Tx } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { sujets, type DossierRdv } from './schema.js';

const sqlCle = (eventId: PgColumn) => sql`'agenda:' || ${eventId}`;

// L'entrée « compte rendu » encore ouverte d'un rendez-vous, déposée par la routine de l'agenda
// (clé `agenda:<eventId>`). Une réunion n'a qu'une entrée : le résumé d'une visio enregistrée ou
// d'un Wispr Flow s'y range au lieu d'en créer une autre.
export async function sujetCompteRenduOuvert(tx: Tx, rdvId: string): Promise<string | null> {
  const [s] = await tx
    .select({ id: sujets.id })
    .from(sujets)
    .innerJoin(
      rendezVous,
      and(eq(rendezVous.instanceId, sujets.instanceId), eq(rendezVous.id, rdvId)),
    )
    .where(
      and(
        eq(sujets.instanceId, currentInstance),
        eq(sujets.type, 'compte_rendu'),
        eq(sujets.statut, 'a_traiter'),
        eq(sujets.source, 'routine'),
        // La clé est construite côté SQL pour rester alignée sur l'identifiant d'agenda.
        eq(sujets.sourceId, sqlCle(rendezVous.eventId)),
      ),
    )
    .limit(1);
  return s?.id ?? null;
}

// Range le résumé d'une visio dans l'entrée ouverte du rendez-vous : elle le propose à Marc dans le
// champ du compte rendu, sans écraser une proposition déjà là. Faux si le rendez-vous n'a pas d'entrée.
export async function proposerResumeAuSujet(
  tx: Tx,
  rdvId: string,
  resume: string,
  dossier?: DossierRdv,
): Promise<boolean> {
  const id = await sujetCompteRenduOuvert(tx, rdvId);
  if (!id) return false;
  await tx
    .update(sujets)
    .set({
      compteRenduPrepare: {
        texte: resume,
        prepareeLe: new Date().toISOString(),
        ...(dossier ? { dossier } : {}),
      },
      updatedAt: new Date(),
    })
    .where(and(eq(sujets.id, id), sql`${sujets.compteRenduPrepare} is null`));
  return true;
}

// L'entrée « compte rendu » ouverte dont le dossier porte ce rendez-vous (celui de la visio ou celui
// de l'agenda retenu) : elle porte déjà la note du second cerveau et la suite, à l'acquittement.
export async function sujetAvecDossierOuvert(tx: Tx, eventId: string): Promise<string | null> {
  const [s] = await tx
    .select({ id: sujets.id })
    .from(sujets)
    .where(
      and(
        eq(sujets.instanceId, currentInstance),
        eq(sujets.type, 'compte_rendu'),
        eq(sujets.statut, 'a_traiter'),
        sql`(${sujets.compteRenduPrepare}->'dossier'->>'sourceRdvEventId' = ${eventId}
          or ${sujets.compteRenduPrepare}->'dossier'->'rdv'->>'eventId' = ${eventId})`,
      ),
    )
    .limit(1);
  return s?.id ?? null;
}
