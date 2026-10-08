// Fictive HubSpot portal for tests: same routes and shapes as the real API (list with paging,
// search on hs_lastmodifieddate, pipelines, v4 associations, writes). Every call is recorded.
import type { HsObject, HsPipeline } from '../src/connecteurs/hubspot/client.js';

export type PortalData = {
  companies: HsObject[];
  contacts: HsObject[];
  deals: HsObject[];
  tasks: HsObject[];
  pipelines: HsPipeline[];
  associations: Record<string, Record<string, string>>;
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

    const list = /^\/crm\/v3\/objects\/(\w+)$/.exec(u.pathname);
    if (list && method === 'GET') {
      const type = list[1] as keyof PortalData;
      const properties = (u.searchParams.get('properties') ?? '').split(',');
      const items = (data[type] as HsObject[]).map((o) => only(o, properties));
      return json(page(items, u.searchParams.get('after') ?? undefined));
    }
    const search = /^\/crm\/v3\/objects\/(\w+)\/search$/.exec(u.pathname);
    if (search && body) {
      const type = search[1] as keyof PortalData;
      const groups = body.filterGroups as { filters: { value: string }[] }[];
      const since = Number(groups[0]?.filters[0]?.value ?? 0);
      const items = (data[type] as HsObject[])
        .filter((o) => new Date(o.properties.hs_lastmodifieddate ?? 0).getTime() > since)
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
          .map((i) => ({ from: { id: i.id }, to: [{ toObjectId: map[i.id] }] })),
      });
    }
    if (/^\/crm\/v3\/objects\/\w+\/\w+$/.test(u.pathname) && method === 'PATCH') {
      return json({ id: u.pathname.split('/').at(-1) });
    }
    if (list && method === 'POST') return json({ id: `9${calls.length}` }, 201);
    return json({ message: `Route inconnue ${method} ${u.pathname}` }, 404);
  };

  return {
    fetch,
    calls,
    failWith: (status: number | null) => {
      failWith = status;
    },
  };
}
