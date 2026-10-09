import { and, asc, eq, isNull, lte } from 'drizzle-orm';
import { evenements, type Evenement } from '../connecteurs/google/google.js';
import { parseReglages } from '../connecteurs/hubspot/reglages.js';
import { connexions } from '../connexions/schema.js';
import { writeVia, type ConnexionDeps } from '../connexions/service.js';
import { contacts, entreprises, opportunites, taches } from '../crm/schema.js';
import { CrmIndisponible } from '../crm/service.js';
import type { Executor } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { logEvent } from '../journal/service.js';
import { loadInstanceSecrets } from '../secrets.js';
import { zoned } from '../connecteurs/google/creneaux.js';
import { compterRealisees, decaler, jourDe, situation } from './realisees.js';

const FUSEAU = 'Europe/Paris';

async function rendezVous(
  instance: Instance,
  agenda: { fournisseur: string; reglages: Record<string, unknown> } | undefined,
  deps: ConnexionDeps,
  maintenant: Date,
): Promise<{ rdv: Evenement[]; etat: 'ok' | 'non_configure' | 'erreur'; erreur?: string }> {
  if (agenda?.fournisseur !== 'google-agenda') return { rdv: [], etat: 'non_configure' };
  const jour = jourDe(maintenant, FUSEAU);
  try {
    const calendriers = Array.isArray(agenda.reglages.calendriers)
      ? (agenda.reglages.calendriers as string[])
      : ['primary'];
    const rdv = await evenements(
      { instance, secrets: await loadInstanceSecrets(deps.secretsDir, instance.slug) },
      zoned(jour, '00:00', FUSEAU),
      zoned(decaler(jour, 1), '00:00', FUSEAU),
      calendriers,
    );
    return { rdv, etat: 'ok' };
  } catch (error) {
    return {
      rdv: [],
      etat: 'erreur',
      erreur: error instanceof Error ? error.message : String(error),
    };
  }
}

// "Your day": meetings, open tasks overdue or due today (Paris days), and what was done.
export async function getBrief(
  db: Executor,
  instance: Instance,
  deps: ConnexionDeps,
  maintenant = new Date(),
) {
  const data = await withInstance(db, instance.id, async (tx) => {
    const finJour = zoned(decaler(jourDe(maintenant, FUSEAU), 1), '00:00', FUSEAU);
    const ouvertes = await tx
      .select({
        id: taches.id,
        titre: taches.titre,
        canal: taches.canal,
        echeance: taches.echeance,
        prepare: taches.prepare,
        source: taches.source,
        contact: contacts.nom,
        entreprise: entreprises.nom,
        opportunite: opportunites.titre,
      })
      .from(taches)
      .leftJoin(
        contacts,
        and(eq(contacts.id, taches.contactId), eq(contacts.instanceId, currentInstance)),
      )
      .leftJoin(
        opportunites,
        and(
          eq(opportunites.id, taches.opportuniteId),
          eq(opportunites.instanceId, currentInstance),
        ),
      )
      .leftJoin(
        entreprises,
        and(eq(entreprises.id, contacts.entrepriseId), eq(entreprises.instanceId, currentInstance)),
      )
      .where(
        and(
          eq(taches.instanceId, currentInstance),
          isNull(taches.faitAt),
          lte(taches.echeance, finJour),
        ),
      )
      .orderBy(asc(taches.echeance));
    const faites = await tx
      .select({ canal: taches.canal, faitAt: taches.faitAt })
      .from(taches)
      .where(eq(taches.instanceId, currentInstance));
    const conn = await tx
      .select({
        kind: connexions.kind,
        fournisseur: connexions.fournisseur,
        reglages: connexions.reglages,
      })
      .from(connexions)
      .where(eq(connexions.instanceId, currentInstance));
    return { ouvertes, faites, conn };
  });

  const crm = data.conn.find((c) => c.kind === 'crm');
  const agenda = data.conn.find((c) => c.kind === 'agenda');
  const { rdv, etat, erreur } = await rendezVous(instance, agenda, deps, maintenant);
  return {
    source: crm?.fournisseur === 'hubspot' ? 'hubspot' : 'natif',
    rdv,
    rdvEtat: etat,
    ...(erreur ? { rdvErreur: erreur } : {}),
    taches: data.ouvertes
      .map((t) => ({ ...t, situation: situation(t.echeance, maintenant, FUSEAU) }))
      .filter((t) => t.situation !== 'plus_tard'),
    realisees: compterRealisees(data.faites, maintenant, FUSEAU),
  };
}

// "Mark done": on the copy, and in the instance's CRM when the task comes from it.
export async function marquerFait(
  db: Executor,
  instance: Instance,
  id: string,
  deps: ConnexionDeps,
  maintenant = new Date(),
) {
  return withInstance(db, instance.id, async (tx) => {
    const [tache] = await tx
      .select()
      .from(taches)
      .where(and(eq(taches.instanceId, currentInstance), eq(taches.id, id)));
    if (!tache) return null;
    if (tache.faitAt) return { tache, simulation: false };

    let simulation = false;
    if (tache.source === 'hubspot') {
      const [crm] = await tx
        .select({ reglages: connexions.reglages })
        .from(connexions)
        .where(and(eq(connexions.instanceId, currentInstance), eq(connexions.kind, 'crm')));
      if (parseReglages(crm?.reglages).sens === 'lecture') {
        throw new CrmIndisponible(
          'CRM en lecture seule : marquez la tâche faite dans HubSpot, elle remontera à la prochaine synchronisation.',
        );
      }
      try {
        const result = await writeVia(
          tx,
          instance,
          'crm',
          { op: 'task.complete', data: { tacheId: tache.id } },
          deps,
        );
        simulation = result.simulation;
      } catch (error) {
        throw new CrmIndisponible(
          `Refusé par HubSpot : ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const [row] = await tx
      .update(taches)
      .set({ faitAt: maintenant, updatedAt: maintenant })
      .where(eq(taches.id, tache.id))
      .returning();
    await logEvent(tx, {
      acteur: 'pilote',
      action: `Tâche marquée faite : ${tache.titre}${simulation ? ' (simulation : HubSpot inchangé)' : ''}`,
      niveau: 'L2',
    });
    return { tache: row ?? tache, simulation };
  });
}
