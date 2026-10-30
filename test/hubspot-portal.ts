// Fictive HubSpot portal for tests: same routes and shapes as the real API (list with paging,
// search on hs_lastmodifieddate, pipelines, v4 associations, writes). Every call is recorded.
import type { HsObject, HsPipeline } from '../src/connecteurs/hubspot/client.js';

export type PortalData = {
  companies: HsObject[];
  notes: HsObject[];
  calls: HsObject[];
  emails: HsObject[];
  meetings: HsObject[];
  contacts: HsObject[];
  deals: HsObject[];
  tasks: HsObject[];
  pipelines: HsPipeline[];
  associations: Record<string, Record<string, string | string[]>>;
};

export type Recorded = { method: string; path: string; body: unknown };

const obj = (id: string, properties: HsObject['properties']): HsObject => ({ id, properties });
const at = (iso: string) => ({ hs_lastmodifieddate: iso });

export function demoPortal(): PortalData {
  return {
    companies: [
      obj('101', {
        name: 'Fonderie Vallière',
        industry: 'MACHINERY',
        city: 'Rumilly',
        numberofemployees: '48',
        domain: 'fonderie-valliere.example',
        ...at('2026-10-01T08:00:00Z'),
      }),
      obj('102', {
        name: 'Menuiserie Arpin',
        industry: 'CONSTRUCTION',
        city: 'Albertville',
        numberofemployees: '17',
        domain: 'menuiserie-arpin.example',
        ...at('2026-10-02T08:00:00Z'),
      }),
      obj('103', {
        name: 'Transports Dalmas',
        industry: 'TRANSPORTATION',
        city: 'Chambéry',
        numberofemployees: '120',
        domain: 'dalmas.example',
        ...at('2026-10-03T08:00:00Z'),
      }),
    ],
    contacts: [
      obj('201', {
        firstname: 'Agathe',
        lastname: 'Vallière',
        email: 'a.valliere@fonderie-valliere.example',
        phone: '04 50 00 00 01',
        jobtitle: 'Présidente',
        associatedcompanyid: '101',
        ...at('2026-10-01T09:00:00Z'),
      }),
      obj('202', {
        firstname: 'Romain',
        lastname: 'Arpin',
        email: 'r.arpin@menuiserie-arpin.example',
        phone: '04 79 00 00 02',
        jobtitle: 'Gérant',
        associatedcompanyid: '102',
        ...at('2026-10-02T09:00:00Z'),
      }),
    ],
    deals: [
      obj('301', {
        dealname: 'Structuration commerciale',
        dealstage: 'qualifiedtobuy',
        pipeline: 'default',
        amount: '14000',
        closedate: '2026-11-15T00:00:00Z',
        hubspot_owner_id: '9001',
        hs_date_entered_appointmentscheduled: '2026-09-20T08:00:00Z',
        hs_v2_date_entered_qualifiedtobuy: '2026-10-01T08:00:00Z',
        ...at('2026-10-04T08:00:00Z'),
      }),
      obj('302', {
        dealname: 'Accompagnement export',
        dealstage: 'closedwon',
        pipeline: 'default',
        amount: '22000.5',
        closedate: '2026-09-30T00:00:00Z',
        ...at('2026-10-04T09:00:00Z'),
      }),
      obj('303', {
        dealname: 'Audit flotte',
        dealstage: 'closedlost',
        pipeline: 'default',
        amount: '6000',
        closed_lost_reason: 'Budget reporté',
        ...at('2026-10-04T10:00:00Z'),
      }),
    ],
    tasks: [
      obj('401', {
        hs_task_subject: 'Relancer Agathe Vallière',
        hs_task_type: 'EMAIL',
        hs_timestamp: '2026-10-07T21:30:00Z',
        hs_task_status: 'NOT_STARTED',
        ...at('2026-10-05T08:00:00Z'),
      }),
      obj('402', {
        hs_task_subject: 'Appeler Romain Arpin',
        hs_task_type: 'CALL',
        hs_timestamp: '2026-10-06T08:00:00Z',
        hs_task_status: 'COMPLETED',
        hs_task_completion_date: '2026-10-06T10:00:00Z',
        ...at('2026-10-06T10:00:00Z'),
      }),
    ],
    notes: [
      obj('501', {
        hs_note_body: '<p>Point &amp; suivi : <b>budget</b> validé&nbsp;!</p>',
        hs_timestamp: '2026-10-03T14:00:00Z',
        ...at('2026-10-03T14:00:00Z'),
      }),
    ],
    calls: [
      obj('601', {
        hs_call_title: 'Appel découverte',
        hs_call_body: 'Besoin de structurer la prospection.',
        hs_timestamp: '2026-09-28T09:00:00Z',
        ...at('2026-09-28T09:30:00Z'),
      }),
    ],
    emails: [
      obj('701', {
        hs_email_subject: 'Proposition commerciale',
        hs_timestamp: '2026-10-02T10:00:00Z',
        ...at('2026-10-02T10:00:00Z'),
      }),
    ],
    meetings: [
      obj('801', {
        hs_meeting_title: 'RDV Fonderie',
        hs_meeting_start_time: '2026-10-06T08:00:00Z',
        hs_timestamp: '2026-10-06T08:00:00Z',
        ...at('2026-10-06T09:00:00Z'),
      }),
    ],
    pipelines: [
      {
        id: 'default',
        label: 'Pipeline des ventes',
        stages: [
          { id: 'appointmentscheduled', label: 'Rendez-vous planifié', displayOrder: 0 },
          { id: 'qualifiedtobuy', label: 'Qualifié', displayOrder: 1 },
          { id: 'presentationscheduled', label: 'Proposition', displayOrder: 2 },
          {
            id: 'closedwon',
            label: 'Gagnée',
            displayOrder: 3,
            metadata: { isClosed: 'true', probability: '1.0' },
          },
          {
            id: 'closedlost',
            label: 'Perdue',
            displayOrder: 4,
            metadata: { isClosed: 'true', probability: '0.0' },
          },
        ],
      },
    ],
    associations: {
      'deals->companies': { '301': '101', '302': '102', '303': '103' },
      'deals->contacts': { '301': '201', '302': '202' },
      'tasks->contacts': { '401': '201', '402': '202' },
      'tasks->deals': { '401': '301' },
      'notes->contacts': { '501': '201' },
      'notes->companies': { '501': '101' },
      'notes->deals': { '501': '301' },
      'calls->contacts': { '601': '202' },
      'emails->contacts': { '701': '201' },
      'meetings->companies': { '801': '101' },
    },
  };
}

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );

export function fakePortal(data: PortalData, { pageSize = 2 } = {}) {
  const calls: Recorded[] = [];
  let failWith: number | null = null;
  // Object types the token may not read (missing scope): 403 on their routes only.
  const refuses = new Set<string>();
  // Ids of created records never repeat, even when a test clears `calls`.
  let cree = 0;
  // Records created through the API exist for HubSpot without being part of the demo data.
  const crees = new Set<string>();

  const only = (o: HsObject, properties: string[]): HsObject => ({
    id: o.id,
    properties: Object.fromEntries(
      Object.entries(o.properties).filter(
        ([k]) => properties.includes(k) || k === 'hs_lastmodifieddate',
      ),
    ),
  });
  const page = (list: HsObject[], after: string | undefined) => {
    const start = after ? Number(after) : 0;
    const results = list.slice(start, start + pageSize);
    const next =
      start + pageSize < list.length ? { next: { after: String(start + pageSize) } } : {};
    return { results, paging: next };
  };

  const fetch = (url: string, init: RequestInit): Promise<Response> => {
    const u = new URL(url);
    const method = init.method ?? 'GET';
    const body =
      typeof init.body === 'string'
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : undefined;
    calls.push({ method, path: `${u.pathname}${u.search}`, body });
    if (failWith !== null)
      return json({ message: 'You have reached your secondly limit.' }, failWith);
    const objet = /^\/crm\/v3\/objects\/(\w+)/.exec(u.pathname)?.[1];
    if (objet && refuses.has(objet))
      return json({ message: "This app hasn't been granted all required scopes" }, 403);

    const list = /^\/crm\/v3\/objects\/(\w+)$/.exec(u.pathname);
    if (list && method === 'GET') {
      const type = list[1] as keyof PortalData;
      const properties = (u.searchParams.get('properties') ?? '').split(',');
      const items = (data[type] as HsObject[]).map((o) => only(o, properties));
      return json(page(items, u.searchParams.get('after') ?? undefined));
    }
    // Like HubSpot: ids merged away or archived are simply missing from the results.
    const lecture = /^\/crm\/v3\/objects\/(\w+)\/batch\/read$/.exec(u.pathname);
    if (lecture && body) {
      const type = lecture[1] as keyof PortalData;
      const ids = new Set((body.inputs as { id: string }[]).map((i) => i.id));
      const items = (data[type] as HsObject[]).filter((o) => ids.has(o.id));
      const creees = [...ids].filter((id) => crees.has(id)).map((id) => ({ id, properties: {} }));
      return json({ results: [...items.map((o) => only(o, [])), ...creees] });
    }
    const search = /^\/crm\/v3\/objects\/(\w+)\/search$/.exec(u.pathname);
    if (search && body) {
      const type = search[1] as keyof PortalData;
      const groups = body.filterGroups as { filters: { propertyName: string; value: string }[] }[];
      const filter = groups[0]?.filters[0];
      const since = Number(filter?.value ?? 0);
      // Like HubSpot: a property the object does not have matches nothing (contacts carry
      // `lastmodifieddate`, the other objects `hs_lastmodifieddate`).
      const items = (data[type] as HsObject[])
        .filter((o) => new Date(o.properties[filter?.propertyName ?? ''] ?? 0).getTime() > since)
        .map((o) => only(o, body.properties as string[]));
      return json(page(items, body.after as string | undefined));
    }
    if (u.pathname === '/crm/v3/pipelines/deals') return json({ results: data.pipelines });
    const assoc = /^\/crm\/v4\/associations\/(\w+)\/(\w+)\/batch\/read$/.exec(u.pathname);
    if (assoc && body) {
      const map = data.associations[`${assoc[1]}->${assoc[2]}`] ?? {};
      const inputs = body.inputs as { id: string }[];
      return json({
        results: inputs
          .filter((i) => map[i.id])
          .map((i) => ({
            from: { id: i.id },
            to: [map[i.id]].flat().map((toObjectId) => ({ toObjectId })),
          })),
      });
    }
    if (/^\/crm\/v3\/objects\/\w+\/\w+$/.test(u.pathname) && method === 'PATCH') {
      return json({ id: u.pathname.split('/').at(-1) });
    }
    if (/^\/crm\/v3\/objects\/\w+\/merge$/.test(u.pathname) && method === 'POST') {
      return json({ id: String(body?.primaryObjectId) });
    }
    if (/^\/crm\/v3\/objects\/\w+\/\w+$/.test(u.pathname) && method === 'DELETE') {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (list && method === 'POST') {
      const id = `9${(cree += 1)}`;
      crees.add(id);
      return json({ id }, 201);
    }
    if (
      /^\/crm\/v4\/objects\/\w+\/\w+\/associations\/default\/\w+\/\w+$/.test(u.pathname) &&
      method === 'PUT'
    ) {
      return json({ status: 'COMPLETE' });
    }
    if (
      /^\/crm\/v4\/objects\/\w+\/\w+\/associations\/\w+\/\w+$/.test(u.pathname) &&
      method === 'DELETE'
    ) {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    return json({ message: `Route inconnue ${method} ${u.pathname}` }, 404);
  };

  return {
    fetch,
    calls,
    failWith: (status: number | null) => {
      failWith = status;
    },
    refuser: (objet: string, oui = true) => {
      if (oui) refuses.add(objet);
      else refuses.delete(objet);
    },
  };
}
