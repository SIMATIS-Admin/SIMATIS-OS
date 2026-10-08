import { and, eq } from 'drizzle-orm';
import type { SyncCtx, WriteOp, WriteResult } from '../../connexions/types.js';
import { contacts, entreprises, opportunites, taches } from '../../crm/schema.js';
import { currentInstance } from '../../db/columns.js';
import { logEvent } from '../../journal/service.js';
import type { HubspotClient } from './client.js';
import { parseReglages } from './reglages.js';

export class EcritureRefusee extends Error {}

type Table = typeof entreprises | typeof contacts | typeof opportunites | typeof taches;

// HubSpot id of a local record; it must be a HubSpot copy of the current instance.
async function hubspotId(ctx: SyncCtx, table: Table, localId: unknown): Promise<string> {
  if (typeof localId !== 'string') throw new EcritureRefusee('Identifiant manquant');
  const [row] = await ctx.tx
    .select({ sourceId: table.sourceId, source: table.source })
    .from(table)
    .where(and(eq(table.instanceId, currentInstance), eq(table.id, localId)));
  if (!row) throw new EcritureRefusee('Fiche introuvable dans cette instance');
  if (row.source !== 'hubspot' || !row.sourceId) {
    throw new EcritureRefusee("Cette fiche n'existe pas dans HubSpot");
  }
  return row.sourceId;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

function splitName(nom: string): { firstname: string; lastname: string } {
  const parts = nom.trim().split(/\s+/);
  return {
    firstname: parts.slice(0, -1).join(' ') || nom.trim(),
    lastname: parts.length > 1 ? (parts.at(-1) ?? '') : '',
  };
}

// Contact → company association, "HUBSPOT_DEFINED" type 279 (contact to company, primary).
const CONTACT_TO_COMPANY = 279;

export async function writeHubspot(
  ctx: SyncCtx,
  op: WriteOp,
  client: HubspotClient,
): Promise<WriteResult> {
  const reglages = parseReglages(ctx.reglages);
  if (reglages.sens === 'lecture') {
    throw new EcritureRefusee('CRM synchronisé en lecture seule : écriture refusée.');
  }
  // Excluded fields are never written, whatever the OS changed locally.
  const sans = (props: Record<string, string | undefined>) =>
    Object.fromEntries(
      Object.entries(props).filter(
        ([k, v]) => v !== undefined && !reglages.champsExclus.includes(k),
      ),
    );

  let call: () => Promise<{ id?: string }>;
  const d = op.data;
  switch (op.op) {
    case 'deal.stage': {
      const id = await hubspotId(ctx, opportunites, d.opportuniteId);
      const etape = str(d.etape);
      if (!etape || !reglages.etapes.some((e) => e.id === etape)) {
        throw new EcritureRefusee(`Étape HubSpot inconnue : ${String(d.etape)}`);
      }
      call = () =>
        client.request('PATCH', `/crm/v3/objects/deals/${id}`, {
          properties: { dealstage: etape },
        });
      break;
    }
    case 'task.complete': {
      const id = await hubspotId(ctx, taches, d.tacheId);
      call = () =>
        client.request('PATCH', `/crm/v3/objects/tasks/${id}`, {
          properties: { hs_task_status: 'COMPLETED' },
        });
      break;
    }
    case 'contact.update': {
      const id = await hubspotId(ctx, contacts, d.contactId);
      const properties = sans({
        email: str(d.email),
        phone: str(d.telephone),
        jobtitle: str(d.fonction),
      });
      call = () => client.request('PATCH', `/crm/v3/objects/contacts/${id}`, { properties });
      break;
    }
    case 'contact.create': {
      const nom = str(d.nom);
      if (!nom) throw new EcritureRefusee('Nom manquant');
      const company = d.entrepriseId ? await hubspotId(ctx, entreprises, d.entrepriseId) : null;
      const properties = sans({
        ...splitName(nom),
        email: str(d.email),
        phone: str(d.telephone),
        jobtitle: str(d.fonction),
      });
      call = () =>
        client.request('POST', '/crm/v3/objects/contacts', {
          properties,
          associations: company
            ? [
                {
                  to: { id: company },
                  types: [
                    {
                      associationCategory: 'HUBSPOT_DEFINED',
                      associationTypeId: CONTACT_TO_COMPANY,
                    },
                  ],
                },
              ]
            : [],
        });
      break;
    }
    case 'company.create': {
      const nom = str(d.nom);
      if (!nom) throw new EcritureRefusee('Nom manquant');
      // `industry` is a fixed list in HubSpot: free text would be rejected, so it is not sent.
      const properties = sans({ name: nom, city: str(d.ville), domain: str(d.domaine) });
      call = () => client.request('POST', '/crm/v3/objects/companies', { properties });
      break;
    }
    default:
      throw new EcritureRefusee(`Écriture HubSpot non prise en charge : ${op.op}`);
  }

  if (!ctx.reel) {
    await logEvent(ctx.tx, {
      acteur: 'os',
      action: `Simulation : écriture HubSpot non envoyée (${op.op})`,
      details: { op: op.op },
    });
    return { simulation: true, op: op.op };
  }
  const result = await call();
  await logEvent(ctx.tx, { acteur: 'os', action: `Écrit dans HubSpot : ${op.op}`, niveau: 'L2' });
  return { simulation: false, op: op.op, ...(result?.id ? { id: result.id } : {}) };
}
