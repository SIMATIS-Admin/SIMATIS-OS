import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { baseVivante } from '../base-vivante/schema.js';
import type { Executor } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { enregistrerAction, indicateurs } from './actions.js';
import {
  salesnavProspects,
  type OrigineActionSalesnav,
  type ProspectSalesnav,
  type StatutProspectSalesnav,
} from './schema.js';

export class ProspectInvalide extends Error {}
export class ProspectIntrouvable extends ProspectInvalide {}

// Une demande restée sans réponse aussi longtemps est signalée « à retirer ».
export const JOURS_AVANT_RETRAIT = 21;
const JOUR_MS = 24 * 60 * 60_000;
const LIMITE_PROPOSITION = 25;

// Un lien de profil Sales Navigator ou LinkedIn, ramené à une forme stable (sans paramètres ni
// barre finale) pour reconnaître la même personne ajoutée deux fois.
export function normaliserLien(brut: string): string {
  const t = brut.trim();
  if (!/^https?:\/\//i.test(t) || !/linkedin\.com\//i.test(t))
    throw new ProspectInvalide('Collez un lien de profil LinkedIn ou Sales Navigator.');
  let url: URL;
  try {
    url = new URL(t);
  } catch {
    throw new ProspectInvalide('Ce lien n’est pas valide.');
  }
  return `https://${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/, '')}`;
}

async function exiger(tx: Executor, id: string): Promise<ProspectSalesnav> {
  const [p] = await tx
    .select()
    .from(salesnavProspects)
    .where(and(eq(salesnavProspects.instanceId, currentInstance), eq(salesnavProspects.id, id)));
  if (!p) throw new ProspectIntrouvable('Prospect introuvable.');
  return p;
}

function depuis(p: ProspectSalesnav, statuts: StatutProspectSalesnav[], action: string) {
  if (!statuts.includes(p.statut))
    throw new ProspectInvalide(`Impossible : ${action} (statut actuel : ${p.statut}).`);
}

export async function ajouterProspect(
  tx: Executor,
  entree: {
    lien: string;
    nom: string;
    fonction?: string | null;
    entreprise?: string | null;
    cible?: string | null;
  },
  maintenant: Date = new Date(),
): Promise<ProspectSalesnav> {
  const lien = normaliserLien(entree.lien);
  const nom = entree.nom.trim();
  if (!nom) throw new ProspectInvalide('Indiquez le nom de la personne.');
  const [deja] = await tx
    .select({ id: salesnavProspects.id })
    .from(salesnavProspects)
    .where(
      and(
        eq(salesnavProspects.instanceId, currentInstance),
        eq(salesnavProspects.lienLinkedin, lien),
      ),
    );
  if (deja) throw new ProspectInvalide('Cette personne est déjà dans le pipe SalesNav.');
  // Ajoutée à la main : elle est proposée tout de suite, sans attendre la sélection du jour.
  const [p] = await tx
    .insert(salesnavProspects)
    .values({
      instanceId: currentInstance,
      nom,
      lienLinkedin: lien,
      fonction: entree.fonction?.trim() || null,
      entreprise: entree.entreprise?.trim() || null,
      cible: entree.cible?.trim() || null,
      statut: 'propose',
      proposeLe: maintenant,
    })
    .returning();
  return p!;
}

// Propose de quoi atteindre le quota du jour : ce qui reste après les demandes déjà envoyées
// aujourd'hui et les propositions encore en attente. On puise d'abord dans la file, puis dans la
// Base des suspects (jamais contactés, avec un lien LinkedIn, sans opposition ni exclusion).
export async function proposerDuJour(
  tx: Executor,
  maintenant: Date = new Date(),
): Promise<{ proposes: number; manque: number }> {
  const etat = await indicateurs(tx, maintenant);
  if (etat.pause) return { proposes: 0, manque: 0 };
  const [{ n }] = (await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(salesnavProspects)
    .where(
      and(
        eq(salesnavProspects.instanceId, currentInstance),
        eq(salesnavProspects.statut, 'propose'),
      ),
    )) as [{ n: number }];
  const besoin = Math.min(LIMITE_PROPOSITION, Math.max(0, etat.restantAujourdhui - n));
  if (besoin === 0) return { proposes: 0, manque: 0 };

  const enFile = await tx
    .select({ id: salesnavProspects.id })
    .from(salesnavProspects)
    .where(
      and(eq(salesnavProspects.instanceId, currentInstance), eq(salesnavProspects.statut, 'file')),
    )
    .orderBy(asc(salesnavProspects.createdAt))
    .limit(besoin);
  let ids = enFile.map((l) => l.id);

  if (ids.length < besoin) {
    const dejaLies = tx
      .select({ id: salesnavProspects.baseId })
      .from(salesnavProspects)
      .where(
        and(eq(salesnavProspects.instanceId, currentInstance), isNotNull(salesnavProspects.baseId)),
      );
    const suspects = await tx
      .select({
        id: baseVivante.id,
        prenom: baseVivante.prenom,
        nom: baseVivante.nom,
        entreprise: baseVivante.entreprise,
        fonction: baseVivante.fonction,
        linkedin: baseVivante.linkedin,
      })
      .from(baseVivante)
      .where(
        and(
          eq(baseVivante.instanceId, currentInstance),
          isNotNull(baseVivante.linkedin),
          eq(baseVivante.statutProspection, 'jamais_contacte'),
          eq(baseVivante.opposition, false),
          isNull(baseVivante.exclusion),
          sql`${baseVivante.id} not in (${dejaLies})`,
        ),
      )
      .orderBy(asc(baseVivante.createdAt))
      .limit((besoin - ids.length) * 3);
    for (const s of suspects) {
      if (ids.length >= besoin) break;
      let lien: string;
      try {
        lien = normaliserLien(s.linkedin ?? '');
      } catch {
        continue;
      }
      const [p] = await tx
        .insert(salesnavProspects)
        .values({
          instanceId: currentInstance,
          baseId: s.id,
          nom: [s.prenom, s.nom].filter(Boolean).join(' '),
          fonction: s.fonction,
          entreprise: s.entreprise,
          lienLinkedin: lien,
          statut: 'file',
        })
        .onConflictDoNothing()
        .returning({ id: salesnavProspects.id });
      if (p) ids.push(p.id);
    }
  }
  ids = ids.slice(0, besoin);
  if (ids.length > 0)
    await tx
      .update(salesnavProspects)
      .set({ statut: 'propose', proposeLe: maintenant, updatedAt: maintenant })
      .where(
        and(eq(salesnavProspects.instanceId, currentInstance), inArray(salesnavProspects.id, ids)),
      );
  return { proposes: ids.length, manque: besoin - ids.length };
}

export async function choisirCible(tx: Executor, id: string, cible: string | null) {
  const p = await exiger(tx, id);
  await tx
    .update(salesnavProspects)
    .set({ cible: cible?.trim() || null, updatedAt: new Date() })
    .where(eq(salesnavProspects.id, p.id));
}

export async function marquerDemandeEnvoyee(
  tx: Executor,
  id: string,
  maintenant = new Date(),
  options: { origine?: OrigineActionSalesnav; forcer?: boolean } = {},
) {
  const p = await exiger(tx, id);
  depuis(p, ['propose'], 'envoyer la demande');
  await enregistrerAction(tx, { type: 'demande_envoyee', ...options }, maintenant);
  await tx
    .update(salesnavProspects)
    .set({ statut: 'demande_envoyee', demandeLe: maintenant, updatedAt: maintenant })
    .where(eq(salesnavProspects.id, p.id));
}

export async function marquerConnecte(tx: Executor, id: string, maintenant = new Date()) {
  const p = await exiger(tx, id);
  depuis(p, ['demande_envoyee'], 'marquer la connexion');
  await tx
    .update(salesnavProspects)
    .set({ statut: 'connecte', accepteLe: maintenant, updatedAt: maintenant })
    .where(eq(salesnavProspects.id, p.id));
}

export async function enregistrerMessage(tx: Executor, id: string, maintenant = new Date()) {
  const p = await exiger(tx, id);
  depuis(p, ['connecte', 'a_repondu'], 'envoyer un message');
  await enregistrerAction(tx, { type: 'message_envoye' }, maintenant);
  await tx
    .update(salesnavProspects)
    .set({ nbMessages: p.nbMessages + 1, dernierMessageLe: maintenant, updatedAt: maintenant })
    .where(eq(salesnavProspects.id, p.id));
}

// Une réponse suppose la connexion : si l'acceptation n'avait pas été notée, elle l'est ici.
// Renvoie le prospect avant mise à jour pour que l'appelant crée l'opportunité du Radar.
export async function marquerReponse(
  tx: Executor,
  id: string,
  maintenant = new Date(),
): Promise<ProspectSalesnav> {
  const p = await exiger(tx, id);
  depuis(p, ['demande_envoyee', 'connecte'], 'noter une réponse');
  await enregistrerAction(tx, { type: 'reponse_recue' }, maintenant);
  await tx
    .update(salesnavProspects)
    .set({
      statut: 'a_repondu',
      reponduLe: maintenant,
      accepteLe: p.accepteLe ?? maintenant,
      updatedAt: maintenant,
    })
    .where(eq(salesnavProspects.id, p.id));
  return p;
}

export async function lierOpportunite(tx: Executor, id: string, opportuniteId: string) {
  await tx
    .update(salesnavProspects)
    .set({ opportuniteId, updatedAt: new Date() })
    .where(and(eq(salesnavProspects.instanceId, currentInstance), eq(salesnavProspects.id, id)));
}

export async function marquerSansReponse(tx: Executor, id: string) {
  const p = await exiger(tx, id);
  depuis(p, ['demande_envoyee', 'connecte'], 'marquer sans réponse');
  await tx
    .update(salesnavProspects)
    .set({ statut: 'sans_reponse', updatedAt: new Date() })
    .where(eq(salesnavProspects.id, p.id));
}

export async function ecarter(tx: Executor, id: string) {
  const p = await exiger(tx, id);
  if (p.statut === 'ecarte') return;
  await tx
    .update(salesnavProspects)
    .set({ statut: 'ecarte', updatedAt: new Date() })
    .where(eq(salesnavProspects.id, p.id));
}

export type StatsPipe = {
  demandesEnvoyees: number;
  acceptees: number;
  tauxAcceptation: number | null;
  messagesEnvoyes: number;
  reponses: number;
  tauxReponse: number | null;
};

const pourcent = (a: number, b: number) => (b === 0 ? null : Math.round((a / b) * 1000) / 10);

// Les statistiques classiques d'une campagne de prospection LinkedIn, sur tout le pipe.
export async function statsPipe(tx: Executor): Promise<StatsPipe> {
  const [r] = await tx
    .select({
      envoyees: sql<number>`count(${salesnavProspects.demandeLe})::int`,
      acceptees: sql<number>`count(${salesnavProspects.accepteLe})::int`,
      messages: sql<number>`coalesce(sum(${salesnavProspects.nbMessages}), 0)::int`,
      reponses: sql<number>`count(${salesnavProspects.reponduLe})::int`,
    })
    .from(salesnavProspects)
    .where(eq(salesnavProspects.instanceId, currentInstance));
  const envoyees = r?.envoyees ?? 0;
  const acceptees = r?.acceptees ?? 0;
  const reponses = r?.reponses ?? 0;
  return {
    demandesEnvoyees: envoyees,
    acceptees,
    tauxAcceptation: pourcent(acceptees, envoyees),
    messagesEnvoyes: r?.messages ?? 0,
    reponses,
    tauxReponse: pourcent(reponses, acceptees),
  };
}

export type ProspectVue = ProspectSalesnav & { aRetirer: boolean };

export async function listerProspects(
  tx: Executor,
  maintenant: Date = new Date(),
): Promise<ProspectVue[]> {
  const lignes = await tx
    .select()
    .from(salesnavProspects)
    .where(
      and(
        eq(salesnavProspects.instanceId, currentInstance),
        inArray(salesnavProspects.statut, [
          'propose',
          'demande_envoyee',
          'connecte',
          'a_repondu',
          'sans_reponse',
        ]),
      ),
    )
    .orderBy(asc(salesnavProspects.createdAt));
  const limite = maintenant.getTime() - JOURS_AVANT_RETRAIT * JOUR_MS;
  return lignes.map((p) => ({
    ...p,
    aRetirer:
      (p.statut === 'demande_envoyee' && !!p.demandeLe && p.demandeLe.getTime() < limite) ||
      (p.statut === 'connecte' &&
        !!(p.dernierMessageLe ?? p.accepteLe) &&
        (p.dernierMessageLe ?? p.accepteLe)!.getTime() < limite),
  }));
}

export async function disponiblesDansLaBase(tx: Executor): Promise<number> {
  const dejaLies = tx
    .select({ id: salesnavProspects.baseId })
    .from(salesnavProspects)
    .where(
      and(eq(salesnavProspects.instanceId, currentInstance), isNotNull(salesnavProspects.baseId)),
    );
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(baseVivante)
    .where(
      and(
        eq(baseVivante.instanceId, currentInstance),
        isNotNull(baseVivante.linkedin),
        eq(baseVivante.statutProspection, 'jamais_contacte'),
        eq(baseVivante.opposition, false),
        isNull(baseVivante.exclusion),
        sql`${baseVivante.id} not in (${dejaLies})`,
      ),
    );
  return r?.n ?? 0;
}
