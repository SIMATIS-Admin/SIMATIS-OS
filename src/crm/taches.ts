import { and, asc, eq, gte, isNull, lt, not, sql, type SQL } from 'drizzle-orm';
import { zoned } from '../connecteurs/google/creneaux.js';
import { parseReglages } from '../connecteurs/hubspot/reglages.js';
import { connexions } from '../connexions/schema.js';
import { writeVia, type ConnexionDeps } from '../connexions/service.js';
import type { Executor, Tx } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { perimetre } from '../instances/service.js';
import { logEvent } from '../journal/service.js';
import { rendezVous } from '../pilotage/brief.js';
import { decaler, jourDe } from '../pilotage/realisees.js';
import { contacts, entreprises, opportunites, taches } from './schema.js';
import { createInCrm, CrmIndisponible } from './service.js';
import { canalDe, typeActivite, type Canal, type TypeActivite } from './type-tache.js';

const FUSEAU = 'Europe/Paris';
const HUBSPOT_TYPE: Record<Canal, string | null> = { email: 'EMAIL', appel: 'CALL', tache: null };

export type ChampsActivite = {
  type?: TypeActivite;
  avecHeure?: boolean;
  dureeMinutes?: number | null;
  occupe?: boolean;
};

export type TacheVue = {
  id: string;
  titre: string;
  notes: string | null;
  canal: Canal;
  type: TypeActivite;
  avecHeure: boolean;
  dureeMinutes: number | null;
  occupe: boolean;
  echeance: string | null;
  fait: boolean;
  origine: 'hubspot' | 'os';
  contact: { id: string; nom: string; email: string | null; telephone: string | null } | null;
  entreprise: { id: string; nom: string } | null;
  opportunite: { id: string; titre: string; clos: 'gagne' | 'perdu' | null } | null;
};

export type SimulationTache = { simulation: true; message: string };

export class TacheInvalide extends Error {}

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
      type: taches.type,
      avecHeure: taches.avecHeure,
      dureeMinutes: taches.dureeMinutes,
      occupe: taches.occupe,
      echeance: taches.echeance,
      faitAt: taches.faitAt,
      source: taches.source,
      contactId: contacts.id,
      contactNom: contacts.nom,
      contactEmail: contacts.email,
      contactTel: contacts.telephone,
      entrepriseId: entreprises.id,
      entrepriseNom: entreprises.nom,
      oppId: opportunites.id,
      oppTitre: opportunites.titre,
      oppClos: opportunites.clos,
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
    // Organisation chosen for the task, else of the deal, else of the person (Pipedrive column).
    .leftJoin(
      entreprises,
      and(
        eq(
          entreprises.id,
          sql`coalesce(${taches.entrepriseId}, ${opportunites.entrepriseId}, ${contacts.entrepriseId})`,
        ),
        eq(entreprises.instanceId, currentInstance),
      ),
    )
    .where(and(eq(taches.instanceId, currentInstance), where))
    .orderBy(asc(taches.echeance));
  return rows.map((r) => ({
    id: r.id,
    titre: r.titre,
    notes: r.notes,
    canal: r.canal,
    type: r.type,
    avecHeure: r.avecHeure,
    dureeMinutes: r.dureeMinutes,
    occupe: r.occupe,
    echeance: r.echeance?.toISOString() ?? null,
    fait: r.faitAt !== null,
    origine: r.source === 'hubspot' ? 'hubspot' : 'os',
    contact:
      r.contactId && r.contactNom
        ? { id: r.contactId, nom: r.contactNom, email: r.contactEmail, telephone: r.contactTel }
        : null,
    entreprise:
      r.entrepriseId && r.entrepriseNom ? { id: r.entrepriseId, nom: r.entrepriseNom } : null,
    opportunite: r.oppId && r.oppTitre ? { id: r.oppId, titre: r.oppTitre, clos: r.oppClos } : null,
  }));
}

// Open activities matching `where` (detail pages: « À venir »).
export const listTachesOuvertes = (tx: Tx, where: SQL) =>
  vues(tx, and(isNull(taches.faitAt), where));

const vue = async (tx: Tx, id: string) => (await vues(tx, eq(taches.id, id)))[0] ?? null;

export async function crmHubspot(tx: Tx) {
  const [crm] = await tx
    .select({ fournisseur: connexions.fournisseur, reglages: connexions.reglages })
    .from(connexions)
    .where(and(eq(connexions.instanceId, currentInstance), eq(connexions.kind, 'crm')));
  if (crm?.fournisseur !== 'hubspot') return null;
  const reglages = parseReglages(crm.reglages);
  // A CRM that does not follow tasks (not yet connected, say) leaves them in the OS.
  return reglages.objets.includes('taches') ? reglages : null;
}

// The week (Paris days, `au` included), plus open tasks overdue or without a due date.
export async function listTaches(
  db: Executor,
  instance: Instance,
  periode: { du: string; au: string },
  deps: ConnexionDeps,
  maintenant = new Date(),
) {
  const debut = zoned(periode.du, '00:00', FUSEAU);
  const fin = zoned(decaler(periode.au, 1), '00:00', FUSEAU);
  const aujourdhui = zoned(jourDe(maintenant, FUSEAU), '00:00', FUSEAU);
  const dansLaSemaine = and(gte(taches.echeance, debut), lt(taches.echeance, fin));
  const ouverte = isNull(taches.faitAt);
  // Mon activité also lists the tasks of every mandate, each read in its own isolated transaction.
  const perimetreInstances = await perimetre(db, instance);
  const refDe = (i: Instance) => ({ slug: i.slug, nom: i.nom, couleur: i.config.couleur ?? null });
  const parInstance = await Promise.all(
    perimetreInstances.map((i) =>
      withInstance(db, i.id, async (tx) => {
        const ref = refDe(i);
        const avecInstance = async (where: SQL | undefined) =>
          (await vues(tx, where)).map((v) => ({ ...v, instance: ref }));
        return {
          taches: await avecInstance(dansLaSemaine),
          // Overdue is relative to today; a task of the week shown stays in its day.
          enRetard: await avecInstance(
            and(ouverte, lt(taches.echeance, aujourdhui), not(dansLaSemaine ?? sql`false`)),
          ),
          sansEcheance: await avecInstance(and(ouverte, isNull(taches.echeance))),
        };
      }),
    ),
  );
  const parEcheance = (a: TacheVue, b: TacheVue) =>
    (a.echeance ? Date.parse(a.echeance) : Infinity) -
    (b.echeance ? Date.parse(b.echeance) : Infinity);
  const reunir = (cle: 'taches' | 'enRetard' | 'sansEcheance') =>
    parInstance.flatMap((p) => p[cle]).sort(parEcheance);
  // The CRM and the calendar are the viewed instance's own.
  const data = await withInstance(db, instance.id, async (tx) => ({
    taches: reunir('taches'),
    enRetard: reunir('enRetard'),
    sansEcheance: reunir('sansEcheance'),
    crm: await crmHubspot(tx),
    agenda: (
      await tx
        .select({ fournisseur: connexions.fournisseur, reglages: connexions.reglages })
        .from(connexions)
        .where(and(eq(connexions.instanceId, currentInstance), eq(connexions.kind, 'agenda')))
    )[0],
  }));
  const { rdv, etat } = await rendezVous(instance, data.agenda, deps, debut, fin);
  return {
    taches: data.taches,
    enRetard: data.enRetard,
    sansEcheance: data.sansEcheance,
    rdv,
    rdvEtat: etat,
    hubspot: data.crm !== null,
    ecrit: data.crm?.sens === 'deux_sens',
    instances: perimetreInstances.map(refDe),
  };
}

// Foreign keys alone would accept a contact, company or deal of another instance.
async function verifierLiens(
  tx: Tx,
  liens: { contactId?: string | null; entrepriseId?: string | null; opportuniteId?: string | null },
) {
  for (const [table, id, nom] of [
    [contacts, liens.contactId, 'Contact'],
    [entreprises, liens.entrepriseId, 'Entreprise'],
    [opportunites, liens.opportuniteId, 'Opportunité'],
  ] as const) {
    if (!id) continue;
    const [found] = await tx
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.instanceId, currentInstance), eq(table.id, id)));
    if (!found) throw new TacheInvalide(`${nom} introuvable dans cette instance`);
  }
}

export async function createTache(
  db: Executor,
  instance: Instance,
  input: {
    titre: string;
    notes?: string | null;
    echeance?: string | null;
    contactId?: string | null;
    entrepriseId?: string | null;
    opportuniteId?: string | null;
    hubspot?: boolean;
  } & ChampsActivite,
  deps: ConnexionDeps,
): Promise<TacheVue | SimulationTache> {
  const titre = input.titre.trim();
  const type = input.type ?? typeActivite(titre);
  const canal = canalDe(type);
  return withInstance(db, instance.id, async (tx) => {
    await verifierLiens(tx, input);
    let sourceId: string | null = null;
    if (input.hubspot) {
      if (!(await crmHubspot(tx))) {
        throw new CrmIndisponible('Aucun CRM HubSpot branché sur cette instance.');
      }
      const crm = await createInCrm(
        tx,
        instance,
        'task.create',
        {
          titre,
          type,
          notes: input.notes,
          echeance: input.echeance,
          contactId: input.contactId,
          entrepriseId: input.entrepriseId,
          opportuniteId: input.opportuniteId,
        },
        deps,
      );
      if (crm && 'simulation' in crm) return SIMULATION;
      sourceId = crm?.sourceId ?? null;
    }
    const [row] = await tx
      .insert(taches)
      .values({
        instanceId: currentInstance,
        titre,
        canal,
        type,
        typeChoisi: input.type !== undefined,
        avecHeure: input.avecHeure ?? false,
        dureeMinutes: input.dureeMinutes ?? null,
        occupe: input.occupe ?? false,
        notes: input.notes ?? null,
        echeance: input.echeance ? new Date(input.echeance) : null,
        contactId: input.contactId ?? null,
        entrepriseId: input.entrepriseId ?? null,
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

// Type after an edit: a type picked by the pilot wins and sticks; otherwise a new title is read
// again, a HubSpot task keeping its HubSpot type as fallback.
function typeApres(
  tache: { type: TypeActivite; canal: Canal; typeChoisi: boolean; source: string },
  titre: string | undefined,
  choisi: TypeActivite | undefined,
) {
  if (choisi) return { type: choisi, canal: canalDe(choisi), typeChoisi: true };
  if (!titre || tache.typeChoisi) return {};
  const type = typeActivite(titre, tache.source === 'hubspot' ? HUBSPOT_TYPE[tache.canal] : null);
  return { type, canal: canalDe(type) };
}

// Menu badge: open activities overdue or due today (Paris day).
export async function compterAFaire(db: Executor, instance: Instance, maintenant = new Date()) {
  const demain = zoned(decaler(jourDe(maintenant, FUSEAU), 1), '00:00', FUSEAU);
  return withInstance(db, instance.id, async (tx) => {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(taches)
      .where(
        and(
          eq(taches.instanceId, currentInstance),
          isNull(taches.faitAt),
          lt(taches.echeance, demain),
        ),
      );
    return row?.n ?? 0;
  });
}

// An OS task changes right away; a HubSpot task is written to HubSpot first (HubSpot is the
// reference), and its copy changes only when the write really happened.
export async function updateTache(
  db: Executor,
  instance: Instance,
  id: string,
  patch: {
    titre?: string;
    notes?: string | null;
    echeance?: string | null;
    fait?: boolean;
    // Person or company the task is about, chosen in the OS (null removes the link).
    contactId?: string | null;
    entrepriseId?: string | null;
  } & ChampsActivite,
  deps: ConnexionDeps,
): Promise<TacheVue | SimulationTache | null> {
  return withInstance(db, instance.id, async (tx) => {
    const [tache] = await tx
      .select()
      .from(taches)
      .where(and(eq(taches.instanceId, currentInstance), eq(taches.id, id)));
    if (!tache) return null;
    const titre = patch.titre?.trim();
    await verifierLiens(tx, patch);
    const lien = patch.contactId !== undefined || patch.entrepriseId !== undefined;

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
          {
            op: 'task.update',
            // Duration and busy flag stay in the OS: HubSpot tasks have no such fields.
            data: {
              tacheId: id,
              ...(titre ? { titre } : {}),
              ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
              ...(patch.echeance !== undefined ? { echeance: patch.echeance } : {}),
              ...(patch.fait !== undefined ? { fait: patch.fait } : {}),
              ...(patch.type ? { type: patch.type } : {}),
              // HubSpot gets the new association; removing one stays a HubSpot gesture.
              ...(patch.contactId ? { contactId: patch.contactId } : {}),
              ...(patch.entrepriseId ? { entrepriseId: patch.entrepriseId } : {}),
            },
          },
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
        ...(titre ? { titre } : {}),
        ...typeApres(tache, titre, patch.type),
        ...(patch.avecHeure !== undefined ? { avecHeure: patch.avecHeure } : {}),
        ...(patch.dureeMinutes !== undefined ? { dureeMinutes: patch.dureeMinutes } : {}),
        ...(patch.occupe !== undefined ? { occupe: patch.occupe } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        ...(patch.echeance !== undefined
          ? { echeance: patch.echeance ? new Date(patch.echeance) : null }
          : {}),
        ...(patch.fait !== undefined ? { faitAt: patch.fait ? new Date() : null } : {}),
        ...(patch.contactId !== undefined ? { contactId: patch.contactId } : {}),
        ...(patch.entrepriseId !== undefined ? { entrepriseId: patch.entrepriseId } : {}),
        ...(lien ? { lienChoisi: true } : {}),
        updatedAt: new Date(),
      })
      .where(eq(taches.id, id));
    if (patch.fait && tache.opportuniteId) {
      await tx
        .update(opportunites)
        .set({ derniereActivite: new Date() })
        .where(
          and(
            eq(opportunites.instanceId, currentInstance),
            eq(opportunites.id, tache.opportuniteId),
          ),
        );
    }
    await logEvent(tx, {
      acteur: 'pilote',
      action: `Tâche modifiée : ${titre ?? tache.titre}`,
      niveau: 'L2',
    });
    return vue(tx, id);
  });
}
