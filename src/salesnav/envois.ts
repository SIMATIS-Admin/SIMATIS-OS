import { and, desc, eq, gte, inArray, isNotNull, lte } from 'drizzle-orm';
import type { Executor } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { logEvent } from '../journal/service.js';
import { indicateurs } from './actions.js';
import { LIMITE_INVITATION } from './modeles.js';
import { marquerDemandeEnvoyee } from './prospects.js';
import { lireReglages, pauseAutomatique } from './reglages.js';
import {
  salesnavEnvois,
  salesnavProspects,
  type EnvoiSalesnav,
  type ProspectSalesnav,
} from './schema.js';

// Envoi d'une demande de connexion par le Chrome du pilote : l'OS tient la file (un seul envoi à la
// fois) et les garde-fous ; l'exécuteur ne fait que cliquer, puis rapporte ce qu'il a vu.

export class EnvoiRefuse extends Error {}

export const HEURE_DEBUT = 9;
export const HEURE_FIN = 18;
export const DELAI_MIN_SECONDES = 120;
// Un envoi demandé que personne n'a pris (exécuteur éteint) ne bloque pas la file indéfiniment.
export const PEREMPTION_MINUTES = 15;
const SEUIL_ACCEPTATION = 0.25;
const ECHANTILLON_MIN = 20;
const ECHANTILLON_MAX = 50;
const JOUR_MS = 24 * 60 * 60_000;

export const RESULTATS_ENVOI = [
  'envoye',
  'deja_connecte',
  'invitation_en_attente',
  'nom_different',
  'introuvable',
  'avertissement',
  'echec',
] as const;
export type ResultatEnvoi = (typeof RESULTATS_ENVOI)[number];

// Jour de semaine (1 = lundi) et heure à Paris.
function parisJourHeure(at: Date): { jour: number; heure: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Paris',
    weekday: 'short',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(at);
  const jourTexte = parts.find((p) => p.type === 'weekday')?.value ?? 'Mon';
  const heure = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const jours = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return { jour: jours.indexOf(jourTexte) + 1, heure };
}

export function dansLesHeuresOuvrees(at: Date): boolean {
  const { jour, heure } = parisJourHeure(at);
  return jour >= 1 && jour <= 5 && heure >= HEURE_DEBUT && heure < HEURE_FIN;
}

async function expirer(tx: Executor, maintenant: Date) {
  const limite = new Date(maintenant.getTime() - PEREMPTION_MINUTES * 60_000);
  await tx
    .update(salesnavEnvois)
    .set({
      statut: 'echec',
      detail: 'Expiré : l’exécuteur n’a pas pris la demande à temps.',
      termineLe: maintenant,
      updatedAt: maintenant,
    })
    .where(
      and(
        eq(salesnavEnvois.instanceId, currentInstance),
        inArray(salesnavEnvois.statut, ['en_attente', 'en_cours']),
        lte(salesnavEnvois.createdAt, limite),
      ),
    );
}

export async function demanderEnvoi(
  tx: Executor,
  prospectId: string,
  noteBrute: string,
  maintenant: Date = new Date(),
): Promise<EnvoiSalesnav> {
  const note = noteBrute.trim();
  if (note === '') throw new EnvoiRefuse('Écrivez la note d’invitation avant d’envoyer.');
  if (note.length > LIMITE_INVITATION)
    throw new EnvoiRefuse(`La note dépasse ${LIMITE_INVITATION} caractères.`);
  if (/\{[^}]*\}/.test(note))
    throw new EnvoiRefuse('La note contient encore une variable non remplie entre accolades.');
  const [prospect] = await tx
    .select({ id: salesnavProspects.id, statut: salesnavProspects.statut })
    .from(salesnavProspects)
    .where(
      and(eq(salesnavProspects.instanceId, currentInstance), eq(salesnavProspects.id, prospectId)),
    );
  if (!prospect) throw new EnvoiRefuse('Prospect introuvable.');
  if (prospect.statut !== 'propose')
    throw new EnvoiRefuse('Seul un profil « Proposé » peut recevoir une demande.');

  const reglages = await lireReglages(tx, maintenant);
  if (reglages.pause)
    throw new EnvoiRefuse(
      reglages.pauseRaison
        ? `Canal en pause : ${reglages.pauseRaison}`
        : 'Le canal SalesNav est en pause : reprenez-le pour envoyer.',
    );

  await expirer(tx, maintenant);
  const [ouvert] = await tx
    .select({ id: salesnavEnvois.id })
    .from(salesnavEnvois)
    .where(
      and(
        eq(salesnavEnvois.instanceId, currentInstance),
        inArray(salesnavEnvois.statut, ['en_attente', 'en_cours']),
      ),
    );
  if (ouvert) throw new EnvoiRefuse('Un envoi est déjà en cours : attendez qu’il soit terminé.');

  const essai = reglages.essaiABlanc;
  // L'essai à blanc ne clique pas « Se connecter » : ces garde-fous protègent le compte LinkedIn.
  if (!essai) {
    if (!dansLesHeuresOuvrees(maintenant))
      throw new EnvoiRefuse(
        `Envoi possible du lundi au vendredi, de ${HEURE_DEBUT} h à ${HEURE_FIN} h (heure de Paris).`,
      );
    const etat = await indicateurs(tx, maintenant);
    if (etat.restantAujourdhui === 0)
      throw new EnvoiRefuse(`Quota atteint : ${etat.quotaJour} demande(s) par jour.`);
    const [dernier] = await tx
      .select({ fin: salesnavEnvois.termineLe })
      .from(salesnavEnvois)
      .where(
        and(
          eq(salesnavEnvois.instanceId, currentInstance),
          eq(salesnavEnvois.statut, 'envoye'),
          isNotNull(salesnavEnvois.termineLe),
        ),
      )
      .orderBy(desc(salesnavEnvois.termineLe))
      .limit(1);
    if (dernier?.fin && maintenant.getTime() - dernier.fin.getTime() < DELAI_MIN_SECONDES * 1000)
      throw new EnvoiRefuse(
        `Patientez ${DELAI_MIN_SECONDES / 60} minutes entre deux demandes pour ménager le compte.`,
      );
  }

  const [envoi] = await tx
    .insert(salesnavEnvois)
    .values({
      instanceId: currentInstance,
      prospectId,
      note,
      essai,
      createdAt: maintenant,
    })
    .returning();
  if (!envoi) throw new Error('Envoi non créé');
  await logEvent(tx, {
    acteur: 'pilote',
    action: `Demande Sales Navigator ${essai ? '(essai à blanc) ' : ''}mise en file`,
    niveau: 'L2',
  });
  return envoi;
}

export type EnvoiAFaire = {
  id: string;
  nom: string;
  lien: string;
  note: string;
  essaiABlanc: boolean;
};

// L'exécuteur prend l'envoi en attente : il passe « en cours » et n'est plus proposé.
export async function recupererEnvoi(
  tx: Executor,
  maintenant: Date = new Date(),
): Promise<EnvoiAFaire | null> {
  await expirer(tx, maintenant);
  const [e] = await tx
    .select({
      id: salesnavEnvois.id,
      note: salesnavEnvois.note,
      essai: salesnavEnvois.essai,
      nom: salesnavProspects.nom,
      lien: salesnavProspects.lienLinkedin,
    })
    .from(salesnavEnvois)
    .innerJoin(salesnavProspects, eq(salesnavProspects.id, salesnavEnvois.prospectId))
    .where(
      and(eq(salesnavEnvois.instanceId, currentInstance), eq(salesnavEnvois.statut, 'en_attente')),
    )
    .orderBy(salesnavEnvois.createdAt)
    .limit(1);
  if (!e) return null;
  await tx
    .update(salesnavEnvois)
    .set({ statut: 'en_cours', updatedAt: maintenant })
    .where(eq(salesnavEnvois.id, e.id));
  return { id: e.id, nom: e.nom, lien: e.lien, note: e.note, essaiABlanc: e.essai };
}

async function prospectDe(tx: Executor, id: string): Promise<ProspectSalesnav | undefined> {
  const [p] = await tx
    .select()
    .from(salesnavProspects)
    .where(and(eq(salesnavProspects.instanceId, currentInstance), eq(salesnavProspects.id, id)));
  return p;
}

const LIBELLES: Record<ResultatEnvoi, string> = {
  envoye: 'Demande envoyée',
  deja_connecte: 'Déjà connecté',
  invitation_en_attente: 'Invitation déjà en attente',
  nom_different: 'Le nom affiché ne correspond pas',
  introuvable: 'Profil introuvable',
  avertissement: 'Avertissement de LinkedIn',
  echec: 'Échec',
};

// Ce que l'exécuteur a vu. Un essai à blanc n'écrit rien sur le prospect ; un avertissement de
// LinkedIn met le canal en pause, essai ou non.
export async function rapporterEnvoi(
  tx: Executor,
  id: string,
  resultat: ResultatEnvoi,
  detail: string | undefined,
  maintenant: Date = new Date(),
): Promise<EnvoiSalesnav> {
  const [envoi] = await tx
    .select()
    .from(salesnavEnvois)
    .where(and(eq(salesnavEnvois.instanceId, currentInstance), eq(salesnavEnvois.id, id)));
  if (!envoi) throw new EnvoiRefuse('Envoi introuvable.');
  if (envoi.statut !== 'en_cours' && envoi.statut !== 'en_attente')
    throw new EnvoiRefuse('Cet envoi est déjà terminé.');

  const texte = [LIBELLES[resultat], detail?.trim()].filter(Boolean).join(' : ');
  let statut: EnvoiSalesnav['statut'];
  if (resultat === 'avertissement') {
    statut = 'echec';
    await pauseAutomatique(tx, 'LinkedIn a affiché un avertissement pendant l’envoi.', maintenant);
  } else if (envoi.essai) {
    statut = 'essai';
  } else if (
    resultat === 'envoye' ||
    resultat === 'deja_connecte' ||
    resultat === 'invitation_en_attente'
  ) {
    statut = 'envoye';
    const p = await prospectDe(tx, envoi.prospectId);
    if (p && p.statut === 'propose') {
      if (resultat === 'envoye') {
        await marquerDemandeEnvoyee(tx, p.id, maintenant, { origine: 'chrome', forcer: true });
      } else {
        // Déjà connecté ou invitation déjà partie : rien n'a été envoyé aujourd'hui, donc rien à compter.
        await tx
          .update(salesnavProspects)
          .set({
            statut: resultat === 'deja_connecte' ? 'connecte' : 'demande_envoyee',
            demandeLe: maintenant,
            ...(resultat === 'deja_connecte' ? { accepteLe: maintenant } : {}),
            updatedAt: maintenant,
          })
          .where(eq(salesnavProspects.id, p.id));
      }
    }
  } else {
    statut = 'echec';
  }

  const [maj] = await tx
    .update(salesnavEnvois)
    .set({ statut, detail: texte, termineLe: maintenant, updatedAt: maintenant })
    .where(eq(salesnavEnvois.id, envoi.id))
    .returning();
  if (!maj) throw new Error('Envoi non mis à jour');
  await logEvent(tx, {
    acteur: 'agent',
    action: `Demande Sales Navigator${envoi.essai ? ' (essai à blanc)' : ''} : ${LIBELLES[resultat]}`,
    niveau: 'L2',
  });
  return maj;
}

export type EnvoiVue = Pick<EnvoiSalesnav, 'id' | 'prospectId' | 'statut' | 'essai' | 'detail'> & {
  note: string;
  creeLe: string;
};

// Dernier envoi de chaque prospect sur les 24 dernières heures, pour afficher « envoi en cours »
// ou le résultat sur la carte.
export async function derniersEnvois(
  tx: Executor,
  maintenant: Date = new Date(),
): Promise<EnvoiVue[]> {
  await expirer(tx, maintenant);
  const lignes = await tx
    .select()
    .from(salesnavEnvois)
    .where(
      and(
        eq(salesnavEnvois.instanceId, currentInstance),
        gte(salesnavEnvois.createdAt, new Date(maintenant.getTime() - JOUR_MS)),
      ),
    )
    .orderBy(desc(salesnavEnvois.createdAt));
  const vus = new Set<string>();
  const sortie: EnvoiVue[] = [];
  for (const l of lignes) {
    if (vus.has(l.prospectId)) continue;
    vus.add(l.prospectId);
    sortie.push({
      id: l.id,
      prospectId: l.prospectId,
      statut: l.statut,
      essai: l.essai,
      detail: l.detail,
      note: l.note,
      creeLe: l.createdAt.toISOString(),
    });
  }
  return sortie;
}

export type AlerteAcceptation = { taux: number; echantillon: number; message: string };

// Un taux d'acceptation bas sur les dernières demandes (au moins sept jours de recul) signale un
// ciblage ou un message à revoir, et un risque pour le compte.
export async function alerteAcceptation(
  tx: Executor,
  maintenant: Date = new Date(),
): Promise<AlerteAcceptation | null> {
  const lignes = await tx
    .select({ accepteLe: salesnavProspects.accepteLe })
    .from(salesnavProspects)
    .where(
      and(
        eq(salesnavProspects.instanceId, currentInstance),
        isNotNull(salesnavProspects.demandeLe),
        lte(salesnavProspects.demandeLe, new Date(maintenant.getTime() - 7 * JOUR_MS)),
      ),
    )
    .orderBy(desc(salesnavProspects.demandeLe))
    .limit(ECHANTILLON_MAX);
  if (lignes.length < ECHANTILLON_MIN) return null;
  const taux = lignes.filter((l) => l.accepteLe).length / lignes.length;
  if (taux >= SEUIL_ACCEPTATION) return null;
  return {
    taux,
    echantillon: lignes.length,
    message: `Seulement ${Math.round(taux * 100)} % de demandes acceptées sur les ${lignes.length} dernières : revoyez le ciblage ou la note avant de continuer.`,
  };
}
