import { eq } from 'drizzle-orm';
import type { Executor } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { logEvent } from '../journal/service.js';
import { QUOTA_DEFAUT, QUOTA_MAX, salesnavReglages } from './schema.js';

export class ReglageInvalide extends Error {}

// Seuils d'alerte du curseur : au-delà de 15 demandes par jour LinkedIn risque de restreindre le
// compte, au-delà de 20 le risque est élevé. La valeur recommandée au départ est 8, la cible 12.
export const QUOTA_ORANGE = 15;
export const QUOTA_ROUGE = 20;
export const QUOTA_RECOMMANDE = 8;
export const QUOTA_CIBLE = 12;
const JOURS_OUVRES = 5;

export type ReglagesSalesnav = {
  quotaJour: number;
  quotaSemaine: number;
  pause: boolean;
  quotaMax: number;
  recommande: number;
  cible: number;
  niveau: 'normal' | 'attention' | 'danger';
};

const niveauDe = (q: number): ReglagesSalesnav['niveau'] =>
  q > QUOTA_ROUGE ? 'danger' : q > QUOTA_ORANGE ? 'attention' : 'normal';

const vue = (quotaJour: number, pause: boolean): ReglagesSalesnav => ({
  quotaJour,
  quotaSemaine: quotaJour * JOURS_OUVRES,
  pause,
  quotaMax: QUOTA_MAX,
  recommande: QUOTA_RECOMMANDE,
  cible: QUOTA_CIBLE,
  niveau: niveauDe(quotaJour),
});

export async function lireReglages(tx: Executor): Promise<ReglagesSalesnav> {
  const [r] = await tx
    .select({ quotaJour: salesnavReglages.quotaJour, pause: salesnavReglages.pause })
    .from(salesnavReglages)
    .where(eq(salesnavReglages.instanceId, currentInstance));
  return vue(r?.quotaJour ?? QUOTA_DEFAUT, r?.pause ?? false);
}

export async function sauverReglages(
  tx: Executor,
  entree: { quotaJour?: number; pause?: boolean },
): Promise<ReglagesSalesnav> {
  const actuel = await lireReglages(tx);
  const quotaJour = entree.quotaJour ?? actuel.quotaJour;
  const pause = entree.pause ?? actuel.pause;
  if (!Number.isInteger(quotaJour) || quotaJour < 0 || quotaJour > QUOTA_MAX)
    throw new ReglageInvalide(`Le quota par jour est un nombre entier de 0 à ${QUOTA_MAX}.`);
  await tx
    .insert(salesnavReglages)
    .values({ instanceId: currentInstance, quotaJour, pause })
    .onConflictDoUpdate({
      target: salesnavReglages.instanceId,
      set: { quotaJour, pause, updatedAt: new Date() },
    });
  await logEvent(tx, {
    acteur: 'pilote',
    action: `Quota Sales Navigator : ${quotaJour} par jour${pause ? ' (en pause)' : ''}`,
    niveau: 'L2',
  });
  return vue(quotaJour, pause);
}
