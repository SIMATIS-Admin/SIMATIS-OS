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
  pauseRaison: string | null;
  essaiABlanc: boolean;
  quotaMax: number;
  recommande: number;
  cible: number;
  niveau: 'normal' | 'attention' | 'danger';
};

const niveauDe = (q: number): ReglagesSalesnav['niveau'] =>
  q > QUOTA_ROUGE ? 'danger' : q > QUOTA_ORANGE ? 'attention' : 'normal';

const vue = (
  quotaJour: number,
  pause: boolean,
  essaiABlanc: boolean,
  pauseRaison: string | null,
): ReglagesSalesnav => ({
  quotaJour,
  quotaSemaine: quotaJour * JOURS_OUVRES,
  pause,
  pauseRaison,
  essaiABlanc,
  quotaMax: QUOTA_MAX,
  recommande: QUOTA_RECOMMANDE,
  cible: QUOTA_CIBLE,
  niveau: niveauDe(quotaJour),
});

// La pause est effective quand le pilote l'a demandée, ou quand l'OS l'a posée (avertissement de
// LinkedIn) et qu'elle n'est pas encore échue.
export async function lireReglages(
  tx: Executor,
  maintenant: Date = new Date(),
): Promise<ReglagesSalesnav> {
  const [r] = await tx
    .select({
      quotaJour: salesnavReglages.quotaJour,
      pause: salesnavReglages.pause,
      essaiABlanc: salesnavReglages.essaiABlanc,
      pauseRaison: salesnavReglages.pauseRaison,
      pauseJusqua: salesnavReglages.pauseJusqua,
    })
    .from(salesnavReglages)
    .where(eq(salesnavReglages.instanceId, currentInstance));
  const pauseAuto = !!r?.pauseJusqua && r.pauseJusqua.getTime() > maintenant.getTime();
  return vue(
    r?.quotaJour ?? QUOTA_DEFAUT,
    (r?.pause ?? false) || pauseAuto,
    r?.essaiABlanc ?? true,
    pauseAuto || r?.pause ? (r?.pauseRaison ?? null) : null,
  );
}

export async function sauverReglages(
  tx: Executor,
  entree: { quotaJour?: number; pause?: boolean; essaiABlanc?: boolean },
): Promise<ReglagesSalesnav> {
  const actuel = await lireReglages(tx);
  const quotaJour = entree.quotaJour ?? actuel.quotaJour;
  if (!Number.isInteger(quotaJour) || quotaJour < 0 || quotaJour > QUOTA_MAX)
    throw new ReglageInvalide(`Le quota par jour est un nombre entier de 0 à ${QUOTA_MAX}.`);
  const essaiABlanc = entree.essaiABlanc ?? actuel.essaiABlanc;
  // Reprendre le canal efface aussi une pause posée par l'OS.
  const reprise = entree.pause === false;
  const pause = entree.pause ?? (actuel.pause && !actuel.pauseRaison);
  const valeurs = {
    quotaJour,
    pause,
    essaiABlanc,
    ...(reprise ? { pauseRaison: null, pauseJusqua: null } : {}),
  };
  await tx
    .insert(salesnavReglages)
    .values({ instanceId: currentInstance, ...valeurs })
    .onConflictDoUpdate({
      target: salesnavReglages.instanceId,
      set: { ...valeurs, updatedAt: new Date() },
    });
  await logEvent(tx, {
    acteur: 'pilote',
    action: `Réglage Sales Navigator : ${quotaJour} par jour${pause ? ' (en pause)' : ''}${essaiABlanc ? ', essai à blanc' : ', envoi réel'}`,
    niveau: 'L2',
  });
  return lireReglages(tx);
}

export const PAUSE_AUTO_JOURS = 7;

// Pause posée par l'OS quand l'exécuteur signale un avertissement de LinkedIn : sept jours, sans
// toucher à la pause du pilote.
export async function pauseAutomatique(
  tx: Executor,
  raison: string,
  maintenant: Date = new Date(),
): Promise<void> {
  const jusqua = new Date(maintenant.getTime() + PAUSE_AUTO_JOURS * 24 * 3600_000);
  await tx
    .insert(salesnavReglages)
    .values({ instanceId: currentInstance, pauseRaison: raison, pauseJusqua: jusqua })
    .onConflictDoUpdate({
      target: salesnavReglages.instanceId,
      set: { pauseRaison: raison, pauseJusqua: jusqua, updatedAt: maintenant },
    });
  await logEvent(tx, {
    acteur: 'os',
    action: `Canal Sales Navigator en pause ${PAUSE_AUTO_JOURS} jours : ${raison}`,
    niveau: 'L3',
  });
}
