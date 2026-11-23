import { and, eq, gte } from 'drizzle-orm';
import type { Executor } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { decaler, jourDe } from '../pilotage/realisees.js';
import { lireReglages } from './reglages.js';
import {
  salesnavActions,
  TYPES_ACTION_SALESNAV,
  type OrigineActionSalesnav,
  type TypeActionSalesnav,
} from './schema.js';

export class ActionInvalide extends Error {}
// Le quota du jour est atteint ou le canal est en pause : l'action n'est pas enregistrée.
export class ActionRefusee extends Error {}

export type Compteurs = Record<TypeActionSalesnav, number>;
export type IndicateursSalesnav = {
  jour: Compteurs;
  semaine: Compteurs;
  quotaJour: number;
  restantAujourdhui: number;
  pause: boolean;
};

const JOUR_MS = 24 * 60 * 60_000;
const vide = (): Compteurs => ({
  demande_envoyee: 0,
  demande_recue: 0,
  message_envoye: 0,
  reponse_recue: 0,
});

// Jour = jour calendaire de Paris ; semaine = les 7 derniers jours avec aujourd'hui (comme la
// Prospection). La marge de 8 jours sur la requête est resserrée ensuite par jour de Paris.
export async function indicateurs(
  tx: Executor,
  maintenant: Date = new Date(),
): Promise<IndicateursSalesnav> {
  const aujourdhui = jourDe(maintenant);
  const debutSemaine = decaler(aujourdhui, -6);
  const lignes = await tx
    .select({ type: salesnavActions.type, at: salesnavActions.createdAt })
    .from(salesnavActions)
    .where(
      and(
        eq(salesnavActions.instanceId, currentInstance),
        gte(salesnavActions.createdAt, new Date(maintenant.getTime() - 8 * JOUR_MS)),
      ),
    );
  const jour = vide();
  const semaine = vide();
  for (const l of lignes) {
    const j = jourDe(l.at);
    if (j >= debutSemaine && j <= aujourdhui) semaine[l.type]++;
    if (j === aujourdhui) jour[l.type]++;
  }
  const reglages = await lireReglages(tx, maintenant);
  return {
    jour,
    semaine,
    quotaJour: reglages.quotaJour,
    restantAujourdhui: Math.max(0, reglages.quotaJour - jour.demande_envoyee),
    pause: reglages.pause,
  };
}

// Enregistre une action faite à la main dans Sales Navigator. Une demande ou un message envoyé est
// refusé quand le canal est en pause ou que le quota de demandes du jour est atteint : le quota
// protège le compte LinkedIn, on ne le dépasse pas par un simple clic.
export async function enregistrerAction(
  tx: Executor,
  entree: {
    type: string;
    opportuniteId?: string | null;
    campagneId?: string | null;
    origine?: OrigineActionSalesnav;
    // L'action a déjà eu lieu sur LinkedIn : on la note même si le quota est atteint ou le canal en pause.
    forcer?: boolean;
  },
  maintenant: Date = new Date(),
): Promise<void> {
  if (!(TYPES_ACTION_SALESNAV as readonly string[]).includes(entree.type))
    throw new ActionInvalide('Type d’action inconnu.');
  const type = entree.type as TypeActionSalesnav;
  if (!entree.forcer && (type === 'demande_envoyee' || type === 'message_envoye')) {
    const etat = await indicateurs(tx, maintenant);
    if (etat.pause)
      throw new ActionRefusee('Le canal SalesNav est en pause : reprenez-le pour envoyer.');
    if (type === 'demande_envoyee' && etat.restantAujourdhui === 0)
      throw new ActionRefusee(
        `Quota atteint : ${etat.quotaJour} demande${etat.quotaJour > 1 ? 's' : ''} par jour. Reprenez demain ou augmentez le quota.`,
      );
  }
  await tx.insert(salesnavActions).values({
    instanceId: currentInstance,
    type,
    origine: entree.origine ?? 'manuel',
    createdAt: maintenant,
    opportuniteId: entree.opportuniteId ?? null,
    campagneId: entree.campagneId ?? null,
  });
}
