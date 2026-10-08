import { and, asc, eq } from 'drizzle-orm';
import { parseReglages } from '../connecteurs/hubspot/reglages.js';
import { connexions } from '../connexions/schema.js';
import { writeVia, type ConnexionDeps } from '../connexions/service.js';
import type { Executor, Tx } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { logEvent } from '../journal/service.js';
import { contacts, entreprises, opportunites } from './schema.js';
import { CrmIndisponible } from './service.js';

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
  etapes: { id: string; label: string }[];
  // HubSpot stages, closed ones included (to close or reopen a deal there).
  hubspot: ReturnType<typeof parseReglages> | null;
  ecrit: boolean;
  derniereSynchro: Date | null;
};

async function pipelineSource(tx: Tx): Promise<Source> {
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
    etapes: reglages.etapes.filter((e) => !e.clos).map((e) => ({ id: e.id, label: e.label })),
    hubspot: reglages,
    ecrit: reglages.sens === 'deux_sens',
    derniereSynchro: crm.derniereSynchro,
  };
}

export async function getPipeline(db: Executor, instance: Instance) {
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
        echeance: opportunites.echeance,
        qualification: opportunites.qualification,
        potentiel: opportunites.potentiel,
        faisabilite: opportunites.faisabilite,
        prochaineEtape: opportunites.prochaineEtape,
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
    return {
      source: src.source,
      ecrit: src.ecrit,
      derniereSynchro: src.derniereSynchro,
      etapes: src.etapes,
      conversions: conversionRates(
        opps,
        src.etapes.map((e) => e.id),
      ),
      opportunites: opps,
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
      .set({ ...next, updatedAt: new Date() })
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
