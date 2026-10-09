import { typeTache } from '../../crm/type-tache.js';
import type { HsObject, HsPipeline } from './client.js';
import type { Etape } from './reglages.js';

// Properties requested for each object type. Excluded fields are removed before the request, so
// they are absent from the answer and never overwrite the local value.
export const PROPRIETES = {
  companies: ['name', 'industry', 'city', 'numberofemployees', 'domain', 'annualrevenue'],
  contacts: ['firstname', 'lastname', 'email', 'phone', 'jobtitle', 'associatedcompanyid'],
  deals: [
    'dealname',
    'dealstage',
    'pipeline',
    'amount',
    'closedate',
    'hubspot_owner_id',
    'closed_lost_reason',
  ],
  tasks: [
    'hs_task_subject',
    'hs_task_body',
    'hs_task_type',
    'hs_timestamp',
    'hs_task_status',
    'hs_task_completion_date',
    'hs_lastmodifieddate',
  ],
};

export const proprietes = (type: keyof typeof PROPRIETES, exclus: string[]) =>
  PROPRIETES[type].filter((p) => !exclus.includes(p));

// Only keys present in the answer: an absent property leaves the local value untouched.
function present<T extends Record<string, unknown>>(values: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(values).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

const has = (h: HsObject, key: string) => Object.hasOwn(h.properties, key);
const text = (h: HsObject, key: string) => (has(h, key) ? (h.properties[key] ?? null) : undefined);
const int = (h: HsObject, key: string) => {
  if (!has(h, key)) return undefined;
  const n = Number.parseFloat(h.properties[key] ?? '');
  return Number.isFinite(n) ? Math.round(n) : null;
};

export function mapCompany(h: HsObject) {
  return {
    nom: h.properties.name || `Entreprise HubSpot ${h.id}`,
    ...present({
      secteur: text(h, 'industry'),
      ville: text(h, 'city'),
      taille: int(h, 'numberofemployees'),
      domaine: text(h, 'domain'),
    }),
  };
}

export function mapContact(h: HsObject) {
  const nom = [h.properties.firstname, h.properties.lastname].filter(Boolean).join(' ').trim();
  return {
    nom: nom || h.properties.email || `Contact HubSpot ${h.id}`,
    ...present({
      email: text(h, 'email'),
      telephone: text(h, 'phone'),
      fonction: text(h, 'jobtitle'),
    }),
    entrepriseSourceId: h.properties.associatedcompanyid ?? null,
  };
}

// Stage list of every deal pipeline, in display order. A closed stage with probability 1 is won.
export function mapStages(pipelines: HsPipeline[]): Etape[] {
  const multiple = pipelines.length > 1;
  return pipelines.flatMap((p, pi) =>
    [...p.stages]
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((s) => {
        const clos =
          s.metadata?.isClosed === 'true' || s.id === 'closedwon' || s.id === 'closedlost';
        const gagne =
          s.id === 'closedwon' || (clos && Number.parseFloat(s.metadata?.probability ?? '0') >= 1);
        return {
          id: s.id,
          label: multiple ? `${p.label} : ${s.label}` : s.label,
          ordre: pi * 1000 + s.displayOrder,
          clos,
          gagne,
        };
      }),
  );
}

export function mapDeal(h: HsObject, etapes: Etape[]) {
  const stage = h.properties.dealstage ?? '';
  const etape = etapes.find((e) => e.id === stage);
  const clos = etape?.clos ? (etape.gagne ? 'gagne' : 'perdu') : null;
  const closedate = text(h, 'closedate');
  return {
    titre: h.properties.dealname || `Transaction HubSpot ${h.id}`,
    etape: stage,
    clos: clos,
    ...present({
      montant: int(h, 'amount'),
      echeance: closedate === undefined ? undefined : (closedate?.slice(0, 10) ?? null),
      proprietaire: text(h, 'hubspot_owner_id'),
      motif: text(h, 'closed_lost_reason'),
    }),
  };
}

export function mapTask(h: HsObject) {
  const titre = h.properties.hs_task_subject || `Tâche HubSpot ${h.id}`;
  const due = h.properties.hs_timestamp;
  const done = h.properties.hs_task_status === 'COMPLETED';
  const doneAt = h.properties.hs_task_completion_date ?? h.properties.hs_lastmodifieddate;
  return {
    titre,
    canal: typeTache(titre, h.properties.hs_task_type),
    echeance: due ? new Date(due) : null,
    faitAt: done && doneAt ? new Date(doneAt) : null,
    ...present({ notes: text(h, 'hs_task_body') }),
  };
}
