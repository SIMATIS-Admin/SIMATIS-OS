import { randomUUID } from 'node:crypto';
import { and, count, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { writeVia, type ConnexionDeps } from '../connexions/service.js';
import { contacts, entreprises } from '../crm/schema.js';
import { createTache, crmHubspot, type SimulationTache } from '../crm/taches.js';
import type { Executor, Tx } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { perimetre } from '../instances/service.js';
import { logEvent } from '../journal/service.js';
import { enrichirPropositions } from '../pilotage/validations.js';
import { propositions } from '../propositions/schema.js';
import { deposerSujet } from './depot.js';
import {
  destinataireLivreBlanc,
  mailLivreBlanc,
  type DestinataireLivreBlanc,
  type NumeroLivreBlanc,
} from './livre-blanc.js';
import {
  SOURCE_MANUELLE,
  sujets,
  type OrigineSujet,
  type StatutSujet,
  type TypeSujet,
} from './schema.js';

export type FiltreInbox =
  'tout' | 'mails' | 'devis' | 'diagnostics' | 'comptes_rendus' | 'a_valider' | 'traites';
export const FILTRES_INBOX: FiltreInbox[] = [
  'tout',
  'mails',
  'devis',
  'diagnostics',
  'comptes_rendus',
  'a_valider',
  'traites',
];

const TYPES_FILTRE: Partial<Record<FiltreInbox, TypeSujet[]>> = {
  mails: ['mail_a_repondre', 'brouillon_non_envoye'],
  devis: ['devis'],
  diagnostics: ['diagnostic'],
  comptes_rendus: ['compte_rendu'],
  a_valider: ['a_valider'],
};

type PropositionVue = Awaited<ReturnType<typeof enrichirPropositions>>[number];

export type SujetVue = {
  id: string;
  type: TypeSujet;
  titre: string;
  resume: string | null;
  origine: OrigineSujet;
  lien: string | null;
  echeance: string | null;
  priorite: number;
  statut: StatutSujet;
  tacheId: string | null;
  createdAt: string;
  traiteAt: string | null;
  contact: { id: string; nom: string } | null;
  entreprise: { id: string; nom: string } | null;
  // Instance the subject lives in: the overview of Mon activité shows it as a badge.
  instance: { slug: string; nom: string; couleur: string | null };
  // For an "à valider" subject: the proposal to decide, as the decision screen shows it.
  proposition: PropositionVue | null;
  // Pour une demande de livre blanc dont l'adresse est lisible : à qui l'envoyer.
  livreBlanc: DestinataireLivreBlanc | null;
};

export class SujetRefuse extends Error {}

const LIMITE = 200;

// Highest priority first, then due dates first, earliest first (so overdue ones lead), then undated ones, newest first.
export function trierInbox(a: SujetVue, b: SujetVue): number {
  if (a.priorite !== b.priorite) return b.priorite - a.priorite;
  if (a.echeance && b.echeance) return a.echeance.localeCompare(b.echeance);
  if (a.echeance) return -1;
  if (b.echeance) return 1;
  return b.createdAt.localeCompare(a.createdAt);
}

const parTraitement = (a: SujetVue, b: SujetVue) =>
  (b.traiteAt ?? '').localeCompare(a.traiteAt ?? '');

async function vues(tx: Tx, instance: Instance, where: SQL | undefined): Promise<SujetVue[]> {
  const rows = await tx
    .select({
      sujet: sujets,
      contactNom: contacts.nom,
      entrepriseNom: entreprises.nom,
    })
    .from(sujets)
    .leftJoin(
      contacts,
      and(eq(contacts.id, sujets.contactId), eq(contacts.instanceId, currentInstance)),
    )
    .leftJoin(
      entreprises,
      and(eq(entreprises.id, sujets.entrepriseId), eq(entreprises.instanceId, currentInstance)),
    )
    .where(and(eq(sujets.instanceId, currentInstance), where))
    .orderBy(desc(sujets.updatedAt))
    .limit(LIMITE);
  const ids = rows.flatMap((r) => (r.sujet.propositionId ? [r.sujet.propositionId] : []));
  const liees = ids.length
    ? await enrichirPropositions(
        tx,
        await tx
          .select()
          .from(propositions)
          .where(and(eq(propositions.instanceId, currentInstance), inArray(propositions.id, ids))),
      )
    : [];
  return rows.map(({ sujet: s, contactNom, entrepriseNom }) => ({
    id: s.id,
    type: s.type,
    titre: s.titre,
    resume: s.resume,
    origine: s.origine,
    lien: s.lien,
    echeance: s.echeance?.toISOString() ?? null,
    priorite: s.priorite,
    statut: s.statut,
    tacheId: s.tacheId,
    createdAt: s.createdAt.toISOString(),
    traiteAt: s.traiteAt?.toISOString() ?? null,
    contact: s.contactId && contactNom ? { id: s.contactId, nom: contactNom } : null,
    entreprise: s.entrepriseId && entrepriseNom ? { id: s.entrepriseId, nom: entrepriseNom } : null,
    instance: { slug: instance.slug, nom: instance.nom, couleur: instance.config.couleur ?? null },
    proposition: liees.find((p) => p.id === s.propositionId) ?? null,
    livreBlanc: destinataireLivreBlanc(s.titre, s.resume),
  }));
}

const condition = (filtre: FiltreInbox): SQL | undefined => {
  if (filtre === 'traites') return inArray(sujets.statut, ['tache', 'traite']);
  const types = TYPES_FILTRE[filtre];
  return and(eq(sujets.statut, 'a_traiter'), types ? inArray(sujets.type, types) : undefined);
};

// Each instance is read in its own isolated transaction; nothing bypasses Row-Level Security.
export async function listInbox(
  db: Executor,
  instance: Instance,
  filtre: FiltreInbox,
): Promise<SujetVue[]> {
  const parInstance = await Promise.all(
    (await perimetre(db, instance)).map((i) =>
      withInstance(db, i.id, (tx) => vues(tx, i, condition(filtre))),
    ),
  );
  return parInstance.flat().sort(filtre === 'traites' ? parTraitement : trierInbox);
}

export async function compterInbox(db: Executor, instance: Instance): Promise<number> {
  const comptes = await Promise.all(
    (await perimetre(db, instance)).map((i) =>
      withInstance(db, i.id, async (tx) => {
        const [row] = await tx
          .select({ n: count() })
          .from(sujets)
          .where(and(eq(sujets.instanceId, currentInstance), eq(sujets.statut, 'a_traiter')));
        return row?.n ?? 0;
      }),
    ),
  );
  return comptes.reduce((a, b) => a + b, 0);
}

// The subject, locked until the end of the transaction (a double click waits, then is refused).
async function charger(tx: Tx, id: string) {
  const [s] = await tx
    .select()
    .from(sujets)
    .where(and(eq(sujets.instanceId, currentInstance), eq(sujets.id, id)))
    .for('update');
  return s ?? null;
}

const vue = async (tx: Tx, instance: Instance, id: string) =>
  (await vues(tx, instance, eq(sujets.id, id)))[0] ?? null;

export type SujetSaisi = {
  titre: string;
  resume?: string | null;
  echeance?: Date | null;
  priorite?: number;
  type?: Exclude<TypeSujet, 'a_valider'>;
};

// An entry typed by the pilot (or prepared with Claude). Each one has its own key; the Inbox routine
// notes it in the second brain at its next run (see sujetsAjoutes).
export async function ajouterSujetTx(
  tx: Tx,
  instance: Instance,
  saisie: SujetSaisi,
): Promise<SujetVue> {
  const { id } = await deposerSujet(tx, {
    type: saisie.type ?? 'autre',
    titre: saisie.titre,
    resume: saisie.resume ?? null,
    origine: 'os',
    source: SOURCE_MANUELLE,
    sourceId: randomUUID(),
    echeance: saisie.echeance ?? null,
    priorite: saisie.priorite,
  });
  await logEvent(tx, {
    acteur: 'pilote',
    action: `Sujet ajouté : ${saisie.titre}`,
    details: { sujet: id },
  });
  const v = await vue(tx, instance, id);
  if (!v) throw new Error('Sujet introuvable après ajout');
  return v;
}

export async function ajouterSujet(
  db: Executor,
  instance: Instance,
  saisie: SujetSaisi,
): Promise<SujetVue> {
  return withInstance(db, instance.id, (tx) => ajouterSujetTx(tx, instance, saisie));
}

export async function marquerTraite(
  db: Executor,
  instance: Instance,
  id: string,
): Promise<SujetVue | null> {
  return withInstance(db, instance.id, async (tx) => {
    const s = await charger(tx, id);
    if (!s) return null;
    if (s.type === 'a_valider') throw new SujetRefuse('Validez ou écartez la proposition.');
    if (s.statut !== 'a_traiter') throw new SujetRefuse('Sujet déjà traité.');
    await tx
      .update(sujets)
      .set({ statut: 'traite', traiteAt: new Date(), traitePar: 'pilote', updatedAt: new Date() })
      .where(eq(sujets.id, id));
    await logEvent(tx, {
      acteur: 'pilote',
      action: `Sujet traité : ${s.titre}`,
      details: { sujet: id },
    });
    return vue(tx, instance, id);
  });
}

// Back to the list; a task created from it stays where it is.
export async function remettreATraiter(
  db: Executor,
  instance: Instance,
  id: string,
): Promise<SujetVue | null> {
  return withInstance(db, instance.id, async (tx) => {
    const s = await charger(tx, id);
    if (!s) return null;
    if (s.type === 'a_valider') throw new SujetRefuse('Une proposition décidée ne revient pas.');
    if (s.statut === 'a_traiter') throw new SujetRefuse('Sujet déjà à traiter.');
    await tx
      .update(sujets)
      // Handled again later, it must be reported again into the second brain.
      .set({
        statut: 'a_traiter',
        traiteAt: null,
        traitePar: null,
        reporteAt: null,
        updatedAt: new Date(),
      })
      .where(eq(sujets.id, id));
    await logEvent(tx, {
      acteur: 'pilote',
      action: `Sujet remis à traiter : ${s.titre}`,
      details: { sujet: id },
    });
    return vue(tx, instance, id);
  });
}

// Due date and priority of an entry, set when it is added or later on. A proposition is decided
// on its own screen, so it keeps its fields.
export type SujetModifie = { echeance?: Date | null; priorite?: number };
export async function modifierSujet(
  db: Executor,
  instance: Instance,
  id: string,
  modif: SujetModifie,
): Promise<SujetVue | null> {
  return withInstance(db, instance.id, async (tx) => {
    const s = await charger(tx, id);
    if (!s) return null;
    if (s.type === 'a_valider') throw new SujetRefuse('Validez ou écartez la proposition.');
    await tx
      .update(sujets)
      .set({ ...modif, updatedAt: new Date() })
      .where(eq(sujets.id, id));
    await logEvent(tx, {
      acteur: 'pilote',
      action: `Sujet modifié : ${s.titre}`,
      details: { sujet: id },
    });
    return vue(tx, instance, id);
  });
}

// The task goes where tasks of the instance go: HubSpot when its CRM is HubSpot, else the OS.
// In simulation nothing is created, so the subject stays to handle.
export async function transformerEnTache(
  db: Executor,
  instance: Instance,
  id: string,
  saisie: Omit<Parameters<typeof createTache>[2], 'hubspot'>,
  deps: ConnexionDeps,
): Promise<SujetVue | SimulationTache | null> {
  return withInstance(db, instance.id, async (tx) => {
    const s = await charger(tx, id);
    if (!s) return null;
    if (s.type === 'a_valider') throw new SujetRefuse('Validez ou écartez la proposition.');
    if (s.statut !== 'a_traiter') throw new SujetRefuse('Sujet déjà traité.');
    const hubspot = (await crmHubspot(tx)) !== null;
    const tache = await createTache(tx, instance, { ...saisie, hubspot }, deps);
    if ('simulation' in tache) return tache;
    await tx
      .update(sujets)
      .set({
        statut: 'tache',
        tacheId: tache.id,
        traiteAt: new Date(),
        traitePar: 'pilote',
        updatedAt: new Date(),
      })
      .where(eq(sujets.id, id));
    await logEvent(tx, {
      acteur: 'pilote',
      action: `Sujet transformé en tâche : ${s.titre}`,
      details: { sujet: id, tache: tache.id },
    });
    return vue(tx, instance, id);
  });
}

export type EnvoiLivreBlanc = { simulation: true; message: string } | SujetVue;

// Envoie le livre blanc depuis la messagerie de l'instance, puis range l'entrée en « traité ».
// Une écriture simulée (verrous d'écriture réelle fermés) n'envoie rien et laisse l'entrée à traiter.
export async function envoyerLivreBlanc(
  db: Executor,
  instance: Instance,
  id: string,
  numero: NumeroLivreBlanc,
  deps: ConnexionDeps,
): Promise<EnvoiLivreBlanc | null> {
  return withInstance(db, instance.id, async (tx) => {
    const s = await charger(tx, id);
    if (!s) return null;
    if (s.statut !== 'a_traiter') throw new SujetRefuse('Sujet déjà traité.');
    const dest = destinataireLivreBlanc(s.titre, s.resume);
    if (!dest) throw new SujetRefuse('Aucune adresse e-mail lisible dans cette demande.');
    let res;
    try {
      res = await tx.transaction((sp) =>
        writeVia(
          sp,
          instance,
          'messagerie',
          {
            op: 'message.send',
            data: { to: dest.email, ...mailLivreBlanc({ numero, nom: dest.nom }) },
          },
          deps,
        ),
      );
    } catch (error) {
      const raison = error instanceof Error ? error.message : String(error);
      throw new SujetRefuse(`Envoi impossible : ${raison}`);
    }
    if (res.simulation) {
      return {
        simulation: true as const,
        message: `Envoi simulé (écritures réelles désactivées) : rien n'est parti vers ${dest.email}.`,
      };
    }
    await tx
      .update(sujets)
      .set({ statut: 'traite', traiteAt: new Date(), traitePar: 'pilote', updatedAt: new Date() })
      .where(eq(sujets.id, id));
    await logEvent(tx, {
      acteur: 'pilote',
      action: `Livre blanc n° ${numero} envoyé : ${s.titre}`,
      details: { sujet: id, livreBlanc: numero },
    });
    return vue(tx, instance, id);
  });
}
