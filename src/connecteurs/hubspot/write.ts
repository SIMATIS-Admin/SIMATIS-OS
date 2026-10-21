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

// HubSpot only knows calls, emails and to-dos; meetings, deadlines and lunches are to-dos there.
const typeHubspot = (type: unknown) =>
  type === 'email' ? 'EMAIL' : type === 'appel' ? 'CALL' : 'TODO';

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
// HUBSPOT_DEFINED note → contact (202), → company (190), → deal (214).
const NOTE_TO_CONTACT = 202;
const NOTE_TO_COMPANY = 190;
const NOTE_TO_DEAL = 214;
// HUBSPOT_DEFINED deal → contact (3), → company (5).
const DEAL_TO_CONTACT = 3;
const DEAL_TO_COMPANY = 5;
const defini = (associationTypeId: number) => ({
  associationCategory: 'HUBSPOT_DEFINED',
  associationTypeId,
});

// Local kind of a link end → its table and HubSpot object type.
function lienHubspot(kind: unknown): { table: Table; objet: string } {
  if (kind === 'affaire') return { table: opportunites, objet: 'deals' };
  if (kind === 'contact') return { table: contacts, objet: 'contacts' };
  if (kind === 'entreprise') return { table: entreprises, objet: 'companies' };
  throw new EcritureRefusee('Type de fiche inconnu');
}

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
  // Default (primary) association between two HubSpot records.
  const associer = (from: string, fromId: string, to: string, toId: string) =>
    client.request('PUT', `/crm/v4/objects/${from}/${fromId}/associations/default/${to}/${toId}`);
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
      const nom = str(d.nom);
      const properties = sans({
        ...(nom ? splitName(nom) : {}),
        email: str(d.email),
        phone: str(d.telephone),
        jobtitle: str(d.fonction),
      });
      const company = d.entrepriseId ? await hubspotId(ctx, entreprises, d.entrepriseId) : null;
      call = async () => {
        if (Object.keys(properties).length > 0 || !company)
          await client.request('PATCH', `/crm/v3/objects/contacts/${id}`, { properties });
        if (company) await associer('contacts', id, 'companies', company);
        return { id };
      };
      break;
    }
    case 'deal.update': {
      const id = await hubspotId(ctx, opportunites, d.opportuniteId);
      const demandes = {
        dealname: str(d.titre),
        amount: typeof d.montant === 'number' ? String(d.montant) : undefined,
        closedate: str(d.echeance),
      };
      const properties = sans(demandes);
      if (Object.keys(properties).length === 0) {
        throw new EcritureRefusee(
          Object.values(demandes).some((v) => v !== undefined)
            ? 'Ces champs sont exclus de la synchronisation HubSpot (Paramètres > Connexions).'
            : 'Aucune modification',
        );
      }
      call = () => client.request('PATCH', `/crm/v3/objects/deals/${id}`, { properties });
      break;
    }
    case 'deal.create': {
      const titre = str(d.titre);
      const etape = str(d.etape);
      if (!titre || !etape) throw new EcritureRefusee('Titre ou étape manquant');
      const pipeline = reglages.etapes.find((e) => e.id === etape)?.pipeline ?? 'default';
      const contact = d.contactId ? await hubspotId(ctx, contacts, d.contactId) : null;
      const company = d.entrepriseId ? await hubspotId(ctx, entreprises, d.entrepriseId) : null;
      const properties = {
        ...sans({
          dealname: titre,
          amount: typeof d.montant === 'number' ? String(d.montant) : undefined,
          closedate: str(d.echeance),
        }),
        dealstage: etape,
        pipeline,
      };
      call = () =>
        client.request('POST', '/crm/v3/objects/deals', {
          properties,
          associations: [
            ...(contact ? [{ to: { id: contact }, types: [defini(DEAL_TO_CONTACT)] }] : []),
            ...(company ? [{ to: { id: company }, types: [defini(DEAL_TO_COMPANY)] }] : []),
          ],
        });
      break;
    }
    case 'deal.associer': {
      const id = await hubspotId(ctx, opportunites, d.opportuniteId);
      const contact = d.contactId ? await hubspotId(ctx, contacts, d.contactId) : null;
      const company = d.entrepriseId ? await hubspotId(ctx, entreprises, d.entrepriseId) : null;
      if (!contact && !company) throw new EcritureRefusee('Aucun lien à écrire');
      call = async () => {
        if (contact) await associer('deals', id, 'contacts', contact);
        if (company) await associer('deals', id, 'companies', company);
        return { id };
      };
      break;
    }
    case 'association.add':
    case 'association.remove': {
      const de = lienHubspot(d.de);
      const vers = lienHubspot(d.vers);
      const from = await hubspotId(ctx, de.table, d.deId);
      const to = await hubspotId(ctx, vers.table, d.versId);
      call = async () => {
        if (op.op === 'association.add') await associer(de.objet, from, vers.objet, to);
        else
          await client.request(
            'DELETE',
            `/crm/v4/objects/${de.objet}/${from}/associations/${vers.objet}/${to}`,
          );
        return { id: from };
      };
      break;
    }
    case 'company.update': {
      const id = await hubspotId(ctx, entreprises, d.entrepriseId);
      const properties = sans({
        name: str(d.nom),
        city: str(d.ville),
        domain: str(d.domaine),
        numberofemployees: typeof d.taille === 'number' ? String(d.taille) : undefined,
      });
      if (Object.keys(properties).length === 0)
        throw new EcritureRefusee('Aucune modification envoyable à HubSpot');
      call = () => client.request('PATCH', `/crm/v3/objects/companies/${id}`, { properties });
      break;
    }
    case 'note.create': {
      const corps = str(d.corps);
      if (!corps) throw new EcritureRefusee('Note vide');
      const liens = [
        [contacts, d.contactId, NOTE_TO_CONTACT],
        [entreprises, d.entrepriseId, NOTE_TO_COMPANY],
        [opportunites, d.opportuniteId, NOTE_TO_DEAL],
      ] as const;
      const associations: {
        to: { id: string };
        types: { associationCategory: string; associationTypeId: number }[];
      }[] = [];
      for (const [table, localId, type] of liens) {
        if (!localId) continue;
        associations.push({
          to: { id: await hubspotId(ctx, table, localId) },
          types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: type }],
        });
      }
      call = () =>
        client.request('POST', '/crm/v3/objects/notes', {
          properties: { hs_note_body: corps, hs_timestamp: new Date().toISOString() },
          associations,
        });
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
    case 'task.update': {
      const id = await hubspotId(ctx, taches, d.tacheId);
      const properties: Record<string, string> = {};
      if (typeof d.titre === 'string') properties.hs_task_subject = d.titre.trim();
      if (typeof d.type === 'string') properties.hs_task_type = typeHubspot(d.type);
      if (typeof d.fait === 'boolean')
        properties.hs_task_status = d.fait ? 'COMPLETED' : 'NOT_STARTED';
      if (typeof d.echeance === 'string')
        properties.hs_timestamp = new Date(d.echeance).toISOString();
      if (d.notes !== undefined)
        properties.hs_task_body = typeof d.notes === 'string' ? d.notes : '';
      const contact = d.contactId ? await hubspotId(ctx, contacts, d.contactId) : null;
      const company = d.entrepriseId ? await hubspotId(ctx, entreprises, d.entrepriseId) : null;
      if (Object.keys(properties).length === 0 && !contact && !company)
        throw new EcritureRefusee('Aucune modification');
      call = async () => {
        if (Object.keys(properties).length > 0)
          await client.request('PATCH', `/crm/v3/objects/tasks/${id}`, { properties });
        if (contact) await associer('tasks', id, 'contacts', contact);
        if (company) await associer('tasks', id, 'companies', company);
        return { id };
      };
      break;
    }
    case 'task.create': {
      const titre = str(d.titre);
      if (!titre) throw new EcritureRefusee('Titre manquant');
      const contact = d.contactId ? await hubspotId(ctx, contacts, d.contactId) : null;
      const deal = d.opportuniteId ? await hubspotId(ctx, opportunites, d.opportuniteId) : null;
      const company = d.entrepriseId ? await hubspotId(ctx, entreprises, d.entrepriseId) : null;
      const type = typeHubspot(typeof d.type === 'string' ? d.type : d.canal);
      const due = typeof d.echeance === 'string' ? new Date(d.echeance) : new Date();
      call = () =>
        client.request('POST', '/crm/v3/objects/tasks', {
          properties: {
            hs_task_subject: titre,
            hs_task_body: str(d.notes) ?? str(d.detail) ?? '',
            hs_task_type: type,
            hs_task_status: 'NOT_STARTED',
            hs_timestamp: due.toISOString(),
          },
          associations: [
            // HUBSPOT_DEFINED task → contact (204), task → deal (216), task → company (192).
            ...(contact
              ? [
                  {
                    to: { id: contact },
                    types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 204 }],
                  },
                ]
              : []),
            ...(deal
              ? [
                  {
                    to: { id: deal },
                    types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 216 }],
                  },
                ]
              : []),
            ...(company
              ? [
                  {
                    to: { id: company },
                    types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 192 }],
                  },
                ]
              : []),
          ],
        });
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
