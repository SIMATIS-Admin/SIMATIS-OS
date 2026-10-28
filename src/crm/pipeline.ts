import { and, asc, eq, ilike, isNotNull, isNull, min, or, sql } from 'drizzle-orm';
import { zoned } from '../connecteurs/google/creneaux.js';
import { parseReglages } from '../connecteurs/hubspot/reglages.js';
import { connexions } from '../connexions/schema.js';
import { writeVia, type ConnexionDeps } from '../connexions/service.js';
import type { Executor, Tx } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { logEvent } from '../journal/service.js';
import { jourDe } from '../pilotage/realisees.js';
import { contacts, entreprises, opportunites, taches } from './schema.js';
import { assurerLiensPrincipaux } from './liens.js';
import { createInCrm, CrmIndisponible, likePattern } from './service.js';

// Native pipeline (instances without CRM, demo data): the mockup's stages (data.js ETAPES).
export const ETAPES_NATIVES = [
  { id: 'detection', label: 'Détection' },
  { id: 'prospection', label: 'Prospection' },
  { id: 'qualification', label: 'Qualification' },
  { id: 'proposition', label: 'Proposition' },
  { id: 'negociation', label: 'Négociation' },
];

// Furthest stage reached: a won deal reached them all, a lost deal counts up to where it stopped.
// Rate k = share of the deals that reached stage k and also reached stage k + 1 (mockup rule).
export function conversionRates(
  opps: { etape: string; clos: 'gagne' | 'perdu' | null }[],
  etapes: string[],
): (number | null)[] {
  const rang = (o: (typeof opps)[number]) =>
    o.clos === 'gagne' ? etapes.length : etapes.indexOf(o.etape);
  const atteint = (k: number) => opps.filter((o) => rang(o) >= k).length;
  return etapes.map((_e, k) => {
    const den = atteint(k);
    return den ? Math.round((atteint(k + 1) / den) * 100) : null;
  });
}

type Source = {
  source: 'natif' | 'hubspot';
  etapes: { id: string; label: string; probabilite?: number | null }[];
  // HubSpot stages, closed ones included (to close or reopen a deal there).
  hubspot: ReturnType<typeof parseReglages> | null;
  ecrit: boolean;
  derniereSynchro: Date | null;
};

export async function pipelineSource(tx: Tx): Promise<Source> {
  const [crm] = await tx
    .select()
    .from(connexions)
    .where(and(eq(connexions.instanceId, currentInstance), eq(connexions.kind, 'crm')));
  if (crm?.fournisseur !== 'hubspot') {
    return {
      source: 'natif',
      etapes: ETAPES_NATIVES,
      hubspot: null,
      ecrit: true,
      derniereSynchro: null,
    };
  }
  const reglages = parseReglages(crm.reglages);
  return {
    source: 'hubspot',
    etapes: reglages.etapes
      .filter((e) => !e.clos)
      .map((e) => ({ id: e.id, label: e.label, probabilite: e.probabilite ?? null })),
    hubspot: reglages,
    ecrit: reglages.sens === 'deux_sens',
    derniereSynchro: crm.derniereSynchro,
  };
}

export const INACTIVITE_DEFAUT = 14;
const JOUR_MS = 86_400_000;

export async function getPipeline(db: Executor, instance: Instance, maintenant = new Date()) {
  const aujourdhui = zoned(jourDe(maintenant, 'Europe/Paris'), '00:00', 'Europe/Paris');
  return withInstance(db, instance.id, async (tx) => {
    const src = await pipelineSource(tx);
    const opps = await tx
      .select({
        id: opportunites.id,
        titre: opportunites.titre,
        etape: opportunites.etape,
        clos: opportunites.clos,
        motif: opportunites.motif,
        montant: opportunites.montant,
        probabilite: opportunites.probabilite,
        modeFacturation: opportunites.modeFacturation,
        dureeEngagementMois: opportunites.dureeEngagementMois,
        taciteReconduction: opportunites.taciteReconduction,
        echeance: opportunites.echeance,
        qualification: opportunites.qualification,
        potentiel: opportunites.potentiel,
        faisabilite: opportunites.faisabilite,
        prochaineEtape: opportunites.prochaineEtape,
        derniereActivite: opportunites.derniereActivite,
        creeLe: opportunites.createdAt,
        entreprise: entreprises.nom,
        contact: contacts.nom,
      })
      .from(opportunites)
      .leftJoin(
        entreprises,
        and(
          eq(entreprises.id, opportunites.entrepriseId),
          eq(entreprises.instanceId, currentInstance),
        ),
      )
      .leftJoin(
        contacts,
        and(eq(contacts.id, opportunites.contactId), eq(contacts.instanceId, currentInstance)),
      )
      .where(eq(opportunites.instanceId, currentInstance))
      .orderBy(asc(opportunites.echeance));
    // Pipedrive signals: the earliest open activity of each deal, and days without activity.
    const prochaines = new Map(
      (
        await tx
          .select({ opp: taches.opportuniteId, echeance: min(taches.echeance) })
          .from(taches)
          .where(
            and(
              eq(taches.instanceId, currentInstance),
              isNull(taches.faitAt),
              isNotNull(taches.opportuniteId),
            ),
          )
          .groupBy(taches.opportuniteId)
      ).map((r) => [r.opp, r.echeance]),
    );
    return {
      source: src.source,
      ecrit: src.ecrit,
      derniereSynchro: src.derniereSynchro,
      etapes: src.etapes,
      conversions: conversionRates(
        opps,
        src.etapes.map((e) => e.id),
      ),
      inactiviteJours: instance.config.inactiviteJours ?? INACTIVITE_DEFAUT,
      opportunites: opps.map(({ derniereActivite, creeLe, ...o }) => {
        const prochaine = o.clos ? null : (prochaines.get(o.id) ?? null);
        const depuis = derniereActivite ?? creeLe;
        return {
          ...o,
          derniereActivite: derniereActivite?.toISOString() ?? null,
          prochaine: prochaine
            ? { echeance: prochaine.toISOString(), enRetard: prochaine < aujourdhui }
            : null,
          joursInactif: o.clos
            ? null
            : Math.floor((maintenant.getTime() - depuis.getTime()) / JOUR_MS),
        };
      }),
    };
  });
}

export type Changement =
  { etape: string } | { clos: 'gagne' | 'perdu'; motif?: string | null } | { rouvrir: true };

export class ChangementInvalide extends Error {}

// Moves, closes or reopens a deal. Under a CRM, the change is written there first (or simulated),
// then on the copy; a read-only CRM refuses it.
export async function changeOpportunite(
  db: Executor,
  instance: Instance,
  id: string,
  change: Changement,
  deps: ConnexionDeps,
) {
  return withInstance(db, instance.id, async (tx) => {
    const [opp] = await tx
      .select()
      .from(opportunites)
      .where(and(eq(opportunites.instanceId, currentInstance), eq(opportunites.id, id)));
    if (!opp) return null;
    const src = await pipelineSource(tx);
    const label = (stage: string) => src.etapes.find((e) => e.id === stage)?.label ?? stage;

    let next: { etape: string; clos: 'gagne' | 'perdu' | null; motif: string | null };
    let action: string;
    if ('etape' in change) {
      if (!src.etapes.some((e) => e.id === change.etape)) {
        throw new ChangementInvalide(`Étape inconnue : ${change.etape}`);
      }
      next = { etape: change.etape, clos: null, motif: null };
      action = `${opp.clos ? 'Opportunité rouverte' : 'Étape changée'} : ${opp.titre} → ${label(change.etape)}`;
    } else if ('clos' in change) {
      // Native deals keep the stage where they stopped; HubSpot ones move to the closed stage.
      const closed = src.hubspot?.etapes.find(
        (e) => e.clos && e.gagne === (change.clos === 'gagne'),
      );
      if (src.hubspot && !closed)
        throw new ChangementInvalide('Aucune étape de clôture dans HubSpot');
      next = {
        etape: closed?.id ?? opp.etape,
        clos: change.clos,
        motif: change.clos === 'perdu' ? (change.motif ?? null) : null,
      };
      action = `Opportunité ${change.clos === 'gagne' ? 'gagnée' : 'perdue'} : ${opp.titre}${next.motif ? ` (${next.motif})` : ''}`;
    } else {
      const lastOpen = src.etapes.at(-1)?.id ?? opp.etape;
      next = {
        etape: src.etapes.some((e) => e.id === opp.etape) ? opp.etape : lastOpen,
        clos: null,
        motif: null,
      };
      action = `Opportunité rouverte : ${opp.titre}`;
    }

    let simulation = false;
    if (src.source === 'hubspot') {
      if (!src.ecrit) {
        throw new CrmIndisponible(
          'Pipeline en lecture seule : changez l’étape dans HubSpot, elle remontera à la prochaine synchronisation.',
        );
      }
      try {
        const result = await writeVia(
          tx,
          instance,
          'crm',
          { op: 'deal.stage', data: { opportuniteId: opp.id, etape: next.etape } },
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
      .update(opportunites)
      .set({
        ...next,
        // Stage entry dates feed the progress bar of the deal page.
        ...(next.etape !== opp.etape && !simulation
          ? { etapesDates: { ...opp.etapesDates, [next.etape]: new Date().toISOString() } }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(opportunites.id, opp.id))
      .returning();
    await logEvent(tx, {
      acteur: 'pilote',
      action: `${action}${simulation ? ' (simulation : HubSpot inchangé)' : ''}`,
      niveau: 'L2',
    });
    return { opportunite: row ?? opp, simulation };
  });
}

// New deal from a pipeline column (Pipedrive « + »): in HubSpot first under a CRM, else in the OS.
export async function createOpportunite(
  db: Executor,
  instance: Instance,
  input: {
    titre: string;
    etape: string;
    montant?: number | null;
    modeFacturation?: 'spot' | 'recurrent';
    dureeEngagementMois?: number;
    taciteReconduction?: boolean;
    echeance?: string | null;
    contactId?: string | null;
    entrepriseId?: string | null;
  },
  deps: ConnexionDeps,
) {
  return withInstance(db, instance.id, async (tx) => {
    const src = await pipelineSource(tx);
    if (!src.etapes.some((e) => e.id === input.etape))
      throw new ChangementInvalide('Étape inconnue ou close');
    for (const [table, id, nom] of [
      [contacts, input.contactId, 'Contact'],
      [entreprises, input.entrepriseId, 'Entreprise'],
    ] as const) {
      if (!id) continue;
      const [found] = await tx
        .select({ id: table.id })
        .from(table)
        .where(and(eq(table.instanceId, currentInstance), eq(table.id, id)));
      if (!found) throw new ChangementInvalide(`${nom} introuvable dans cette instance`);
    }
    const crm = await createInCrm(tx, instance, 'deal.create', input, deps);
    if (crm && 'simulation' in crm) return crm;
    const [row] = await tx
      .insert(opportunites)
      .values({
        instanceId: currentInstance,
        titre: input.titre.trim(),
        etape: input.etape,
        montant: input.montant ?? null,
        modeFacturation: input.modeFacturation ?? 'spot',
        dureeEngagementMois: input.dureeEngagementMois ?? 12,
        taciteReconduction: input.taciteReconduction ?? true,
        echeance: input.echeance ?? null,
        contactId: input.contactId ?? null,
        entrepriseId: input.entrepriseId ?? null,
        etapesDates: { [input.etape]: new Date().toISOString() },
        ...(crm ? { source: 'hubspot', sourceId: crm.sourceId } : {}),
      })
      .returning();
    if (!row) throw new Error('Opportunité non créée');
    await assurerLiensPrincipaux(tx, 'affaire', row.id);
    await logEvent(tx, {
      acteur: 'pilote',
      action: `Opportunité créée : ${row.titre}`,
      niveau: 'L2',
    });
    return row;
  });
}

// Deals to link an activity to (Pipedrive activity window), open ones first.
export async function rechercherOpportunites(db: Executor, instance: Instance, q: string) {
  const motif = likePattern(q);
  return withInstance(db, instance.id, (tx) =>
    tx
      .select({
        id: opportunites.id,
        titre: opportunites.titre,
        entreprise: entreprises.nom,
        clos: opportunites.clos,
      })
      .from(opportunites)
      .leftJoin(
        entreprises,
        and(
          eq(entreprises.id, opportunites.entrepriseId),
          eq(entreprises.instanceId, currentInstance),
        ),
      )
      .where(
        and(
          eq(opportunites.instanceId, currentInstance),
          or(ilike(opportunites.titre, motif), ilike(entreprises.nom, motif)),
        ),
      )
      .orderBy(sql`${opportunites.clos} nulls first`, asc(opportunites.titre))
      .limit(10),
  );
}
