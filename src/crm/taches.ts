import { and, asc, eq, gte, isNull, lt, type SQL } from 'drizzle-orm';
import { zoned } from '../connecteurs/google/creneaux.js';
import { parseReglages } from '../connecteurs/hubspot/reglages.js';
import { connexions } from '../connexions/schema.js';
import { writeVia, type ConnexionDeps } from '../connexions/service.js';
import type { Executor, Tx } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { logEvent } from '../journal/service.js';
import { rendezVous } from '../pilotage/brief.js';
import { decaler } from '../pilotage/realisees.js';
import { contacts, opportunites, taches } from './schema.js';
import { createInCrm, CrmIndisponible } from './service.js';
import { typeTache, type Canal } from './type-tache.js';

const FUSEAU = 'Europe/Paris';
const HUBSPOT_TYPE: Record<Canal, string | null> = { email: 'EMAIL', appel: 'CALL', tache: null };

export type TacheVue = {
  id: string;
  titre: string;
  notes: string | null;
  canal: Canal;
  echeance: string | null;
  fait: boolean;
  origine: 'hubspot' | 'os';
  contact: { id: string; nom: string } | null;
  opportunite: { id: string; titre: string } | null;
};

export type SimulationTache = { simulation: true; message: string };

const SIMULATION: SimulationTache = {
  simulation: true,
  message: "Simulation : rien n'a été écrit dans HubSpot (écritures réelles désactivées).",
};

async function vues(tx: Tx, where: SQL | undefined): Promise<TacheVue[]> {
  const rows = await tx
    .select({
      id: taches.id,
      titre: taches.titre,
      notes: taches.notes,
      canal: taches.canal,
      echeance: taches.echeance,
      faitAt: taches.faitAt,
      source: taches.source,
      contactId: contacts.id,
      contactNom: contacts.nom,
      oppId: opportunites.id,
      oppTitre: opportunites.titre,
    })
    .from(taches)
    .leftJoin(
      contacts,
      and(eq(contacts.id, taches.contactId), eq(contacts.instanceId, currentInstance)),
    )
    .leftJoin(
      opportunites,
      and(eq(opportunites.id, taches.opportuniteId), eq(opportunites.instanceId, currentInstance)),
    )
    .where(and(eq(taches.instanceId, currentInstance), where))
    .orderBy(asc(taches.echeance));
  return rows.map((r) => ({
    id: r.id,
    titre: r.titre,
    notes: r.notes,
    canal: r.canal,
    echeance: r.echeance?.toISOString() ?? null,
    fait: r.faitAt !== null,
    origine: r.source === 'hubspot' ? 'hubspot' : 'os',
    contact: r.contactId && r.contactNom ? { id: r.contactId, nom: r.contactNom } : null,
    opportunite: r.oppId && r.oppTitre ? { id: r.oppId, titre: r.oppTitre } : null,
  }));
}

const vue = async (tx: Tx, id: string) => (await vues(tx, eq(taches.id, id)))[0] ?? null;

async function crmHubspot(tx: Tx) {
  const [crm] = await tx
    .select({ fournisseur: connexions.fournisseur, reglages: connexions.reglages })
    .from(connexions)
    .where(and(eq(connexions.instanceId, currentInstance), eq(connexions.kind, 'crm')));
  return crm?.fournisseur === 'hubspot' ? parseReglages(crm.reglages) : null;
}

// The week (Paris days, `au` included), plus open tasks overdue or without a due date.
export async function listTaches(
  db: Executor,
  instance: Instance,
  periode: { du: string; au: string },
  deps: ConnexionDeps,
) {
  const debut = zoned(periode.du, '00:00', FUSEAU);
  const fin = zoned(decaler(periode.au, 1), '00:00', FUSEAU);
  const data = await withInstance(db, instance.id, async (tx) => {
    const ouverte = isNull(taches.faitAt);
    return {
      taches: await vues(tx, and(gte(taches.echeance, debut), lt(taches.echeance, fin))),
      enRetard: await vues(tx, and(ouverte, lt(taches.echeance, debut))),
      sansEcheance: await vues(tx, and(ouverte, isNull(taches.echeance))),
      crm: await crmHubspot(tx),
      agenda: (
        await tx
          .select({ fournisseur: connexions.fournisseur, reglages: connexions.reglages })
          .from(connexions)
          .where(and(eq(connexions.instanceId, currentInstance), eq(connexions.kind, 'agenda')))
      )[0],
    };
  });
  const { rdv, etat } = await rendezVous(instance, data.agenda, deps, debut, fin);
  return {
    taches: data.taches,
    enRetard: data.enRetard,
    sansEcheance: data.sansEcheance,
    rdv,
    rdvEtat: etat,
    hubspot: data.crm !== null,
    ecrit: data.crm?.sens === 'deux_sens',
  };
}

export async function createTache(
  db: Executor,
  instance: Instance,
  input: {
    titre: string;
    notes?: string | null;
    echeance?: string | null;
    contactId?: string | null;
    opportuniteId?: string | null;
    hubspot?: boolean;
  },
  deps: ConnexionDeps,
): Promise<TacheVue | SimulationTache> {
  const titre = input.titre.trim();
  const canal = typeTache(titre);
  return withInstance(db, instance.id, async (tx) => {
    let sourceId: string | null = null;
    if (input.hubspot) {
      if (!(await crmHubspot(tx))) {
        throw new CrmIndisponible('Aucun CRM HubSpot branché sur cette instance.');
      }
      const crm = await createInCrm(tx, instance, 'task.create', { ...input, titre, canal }, deps);
      if (crm && 'simulation' in crm) return SIMULATION;
      sourceId = crm?.sourceId ?? null;
    }
    const [row] = await tx
      .insert(taches)
      .values({
        instanceId: currentInstance,
        titre,
        canal,
        notes: input.notes ?? null,
        echeance: input.echeance ? new Date(input.echeance) : null,
        contactId: input.contactId ?? null,
        opportuniteId: input.opportuniteId ?? null,
        ...(sourceId ? { source: 'hubspot', sourceId } : {}),
      })
      .returning({ id: taches.id });
    if (!row) throw new Error('Tâche non créée');
    await logEvent(tx, { acteur: 'pilote', action: `Tâche créée : ${titre}`, niveau: 'L2' });
    const created = await vue(tx, row.id);
    if (!created) throw new Error('Tâche non créée');
    return created;
  });
}

// An OS task changes right away; a HubSpot task is written to HubSpot first (HubSpot is the
// reference), and its copy changes only when the write really happened.
export async function updateTache(
  db: Executor,
  instance: Instance,
  id: string,
  patch: { titre?: string; notes?: string | null; echeance?: string | null; fait?: boolean },
  deps: ConnexionDeps,
): Promise<TacheVue | SimulationTache | null> {
  return withInstance(db, instance.id, async (tx) => {
    const [tache] = await tx
      .select()
      .from(taches)
      .where(and(eq(taches.instanceId, currentInstance), eq(taches.id, id)));
    if (!tache) return null;
    const titre = patch.titre?.trim();

    if (tache.source === 'hubspot') {
      if ((await crmHubspot(tx))?.sens !== 'deux_sens') {
        throw new CrmIndisponible(
          'CRM en lecture seule : modifiez la tâche dans HubSpot, elle remontera à la prochaine synchronisation.',
        );
      }
      let result;
      try {
        result = await writeVia(
          tx,
          instance,
          'crm',
          { op: 'task.update', data: { tacheId: id, ...patch, ...(titre ? { titre } : {}) } },
          deps,
        );
      } catch (error) {
        throw new CrmIndisponible(
          `Refusé par HubSpot : ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (result.simulation) return SIMULATION;
    }

    await tx
      .update(taches)
      .set({
        // A HubSpot task keeps its HubSpot type as fallback when the new title names no channel.
        ...(titre
          ? {
              titre,
              canal: typeTache(
                titre,
                tache.source === 'hubspot' ? HUBSPOT_TYPE[tache.canal] : null,
              ),
            }
          : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        ...(patch.echeance !== undefined
          ? { echeance: patch.echeance ? new Date(patch.echeance) : null }
          : {}),
        ...(patch.fait !== undefined ? { faitAt: patch.fait ? new Date() : null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(taches.id, id));
    await logEvent(tx, {
      acteur: 'pilote',
      action: `Tâche modifiée : ${titre ?? tache.titre}`,
      niveau: 'L2',
    });
    return vue(tx, id);
  });
}
