import { and, desc, eq, gte, inArray, isNotNull } from 'drizzle-orm';
import { baseVivante } from '../base-vivante/schema.js';
import { contacts } from '../crm/schema.js';
import type { Executor } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { sujets } from '../inbox/schema.js';
import { CampagneInvalide, verifierReglage } from './campagnes.js';
import {
  prospectionBrouillons,
  prospectionCampagnes,
  prospectionOccurrences,
  prospectionSuiviFroid,
  type ReglageCampagne,
} from './schema.js';

const JOURS_MAX = 120;
// Un identifiant de fil Gmail fait 16 caractères : en dessous, un recoupement serait un hasard.
const LONGUEUR_FIL_MIN = 8;

export type ReponseCampagne = {
  occurrenceId: string;
  mode: 'relance' | 'froid';
  contactNom: string;
  societe: string | null;
  theme: string;
  touche: number;
  etat: string;
};

// Une entrée « mail à répondre » est la réponse à une campagne quand le fil de son mail (clé ou lien
// de l'entrée) est celui d'un mail de campagne : on prend le plus récent.
async function occurrenceDe(tx: Executor, sujetId: string) {
  const [sujet] = await tx
    .select({ type: sujets.type, sourceId: sujets.sourceId, lien: sujets.lien })
    .from(sujets)
    .where(and(eq(sujets.instanceId, currentInstance), eq(sujets.id, sujetId)));
  if (!sujet || sujet.type !== 'mail_a_repondre') return null;
  const cherche = `${sujet.sourceId ?? ''} ${sujet.lien ?? ''}`;
  if (!cherche.trim()) return null;
  const candidates = await tx
    .select()
    .from(prospectionOccurrences)
    .where(
      and(
        eq(prospectionOccurrences.instanceId, currentInstance),
        isNotNull(prospectionOccurrences.threadId),
        gte(prospectionOccurrences.createdAt, new Date(Date.now() - JOURS_MAX * 86400_000)),
      ),
    )
    .orderBy(desc(prospectionOccurrences.createdAt));
  return (
    candidates.find(
      (o) => (o.threadId ?? '').length >= LONGUEUR_FIL_MIN && cherche.includes(o.threadId ?? ''),
    ) ?? null
  );
}

export async function reponseDeSujet(
  tx: Executor,
  sujetId: string,
): Promise<ReponseCampagne | null> {
  const o = await occurrenceDe(tx, sujetId);
  return o
    ? {
        occurrenceId: o.id,
        mode: o.mode,
        contactNom: o.contactNom,
        societe: o.societe,
        theme: o.theme,
        touche: o.touche,
        etat: o.etat,
      }
    : null;
}

// Brouillon de réponse à un contact qui a répondu à une campagne. Dès qu'une réponse est reconnue,
// le contact quitte la séquence : l'occurrence passe à « réponse », et le contact de la base à
// froid devient « répondu » (il ne sera plus proposé).
export async function creerCampagneReponse(
  tx: Executor,
  input: { sujetId: string; reglage: ReglageCampagne },
): Promise<{ campagneId: string }> {
  const o = await occurrenceDe(tx, input.sujetId);
  if (!o) throw new CampagneInvalide('Cette entrée ne répond à aucune campagne de prospection.');

  const [ouverte] = await tx
    .select({ id: prospectionCampagnes.id })
    .from(prospectionBrouillons)
    .innerJoin(prospectionCampagnes, eq(prospectionCampagnes.id, prospectionBrouillons.campagneId))
    .where(
      and(
        eq(prospectionBrouillons.instanceId, currentInstance),
        eq(prospectionBrouillons.sujetId, input.sujetId),
        inArray(prospectionCampagnes.statut, ['redaction', 'relecture']),
      ),
    );
  if (ouverte) return { campagneId: ouverte.id };

  await verifierReglage(tx, input.reglage);
  const [email] = o.contactId
    ? await tx
        .select({ email: contacts.email })
        .from(contacts)
        .where(and(eq(contacts.instanceId, currentInstance), eq(contacts.id, o.contactId)))
    : o.baseId
      ? await tx
          .select({ email: baseVivante.email })
          .from(baseVivante)
          .where(and(eq(baseVivante.instanceId, currentInstance), eq(baseVivante.id, o.baseId)))
      : [];
  if (!email?.email) {
    throw new CampagneInvalide(
      "L'adresse du contact est introuvable : rédigez la réponse dans votre messagerie.",
    );
  }

  const [campagne] = await tx
    .insert(prospectionCampagnes)
    .values({ instanceId: currentInstance, mode: 'reponse', reglage: input.reglage })
    .returning({ id: prospectionCampagnes.id });
  if (!campagne) throw new Error('Campagne non créée');
  await tx.insert(prospectionBrouillons).values({
    instanceId: currentInstance,
    campagneId: campagne.id,
    contactId: o.contactId,
    baseId: o.baseId,
    sujetId: input.sujetId,
    contactNom: o.contactNom,
    contactEmail: email.email,
    societe: o.societe,
    touche: o.touche + 1,
    threadId: o.threadId,
  });

  await tx
    .update(prospectionOccurrences)
    .set({
      etat: 'reponse',
      envoyeAt: o.envoyeAt ?? o.createdAt,
      updatedAt: new Date(),
    })
    .where(eq(prospectionOccurrences.id, o.id));
  if (o.baseId) {
    await tx
      .update(prospectionSuiviFroid)
      .set({ statut: 'repondu', updatedAt: new Date() })
      .where(
        and(
          eq(prospectionSuiviFroid.instanceId, currentInstance),
          eq(prospectionSuiviFroid.baseId, o.baseId),
        ),
      );
  }
  return { campagneId: campagne.id };
}
