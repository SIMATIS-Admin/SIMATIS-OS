export class HubspotError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type HsObject = {
  id: string;
  properties: Record<string, string | null | undefined>;
};

export type HsStage = {
  id: string;
  label: string;
  displayOrder: number;
  metadata?: { isClosed?: string; probability?: string };
};
export type HsPipeline = { id: string; label: string; stages: HsStage[] };

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type ClientOptions = {
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  baseUrl?: string;
  retries?: number;
};

const PAGE = 100;

// Private-app token client for the HubSpot CRM v3 API. Retries rate limits (429) and server errors
// with exponential backoff, then raises HubspotError. The token never appears in an error message.
export function hubspotClient(token: string, options: ClientOptions = {}) {
  const doFetch = options.fetch ?? ((url, init) => fetch(url, init));
  const sleep = options.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const baseUrl = options.baseUrl ?? 'https://api.hubapi.com';
  const retries = options.retries ?? 3;

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        response = await doFetch(`${baseUrl}${path}`, {
          method,
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (error) {
        if (attempt < retries - 1) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
        const reason = error instanceof Error ? error.message : String(error);
        throw new HubspotError(`HubSpot injoignable : ${reason}`, 0);
      }
      if (response.ok) {
        return (response.status === 204 ? undefined : await response.json()) as T;
      }
      if ((response.status === 429 || response.status >= 500) && attempt < retries - 1) {
        const retryAfter = Number(response.headers.get('retry-after'));
        await sleep(retryAfter > 0 ? Math.min(retryAfter, 10) * 1000 : 500 * 2 ** attempt);
        continue;
      }
      const detail = (await response.json().catch(() => ({}))) as { message?: string };
      const label = response.status === 429 ? ' (limite de débit)' : '';
      throw new HubspotError(
        `HubSpot ${response.status}${label}${detail.message ? ` : ${detail.message}` : ''}`,
        response.status,
      );
    }
  }

  // Full history (first pass): list endpoint, no 10 000-result cap.
  async function listAll(objectType: string, properties: string[]): Promise<HsObject[]> {
    const out: HsObject[] = [];
    let after: string | undefined;
    do {
      const query = new URLSearchParams({ limit: String(PAGE), properties: properties.join(',') });
      if (after) query.set('after', after);
      const page = await request<{ results: HsObject[]; paging?: { next?: { after: string } } }>(
        'GET',
        `/crm/v3/objects/${objectType}?${query.toString()}`,
      );
      out.push(...page.results);
      after = page.paging?.next?.after;
    } while (after);
    return out;
  }

  // Incremental passes: only what changed since the last successful sync.
  async function modifiedSince(
    objectType: string,
    since: Date,
    properties: string[],
  ): Promise<HsObject[]> {
    const out: HsObject[] = [];
    let after: string | undefined;
    do {
      const page = await request<{ results: HsObject[]; paging?: { next?: { after: string } } }>(
        'POST',
        `/crm/v3/objects/${objectType}/search`,
        {
          filterGroups: [
            {
              filters: [
                {
                  propertyName: 'hs_lastmodifieddate',
                  operator: 'GT',
                  value: String(since.getTime()),
                },
              ],
            },
          ],
          sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'ASCENDING' }],
          properties,
          limit: PAGE,
          ...(after ? { after } : {}),
        },
      );
      out.push(...page.results);
      after = page.paging?.next?.after;
    } while (after);
    return out;
  }

  async function dealPipelines(): Promise<HsPipeline[]> {
    return (await request<{ results: HsPipeline[] }>('GET', '/crm/v3/pipelines/deals')).results;
  }

  // First associated record of each object (deal → company, task → contact…).
  async function firstAssociations(
    from: string,
    to: string,
    ids: string[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 1000) {
      const chunk = ids.slice(i, i + 1000);
      const result = await request<{
        results: { from: { id: string }; to: { toObjectId: string | number }[] }[];
      }>('POST', `/crm/v4/associations/${from}/${to}/batch/read`, {
        inputs: chunk.map((id) => ({ id })),
      });
      for (const r of result.results) {
        const first = r.to[0];
        if (first) out.set(r.from.id, String(first.toObjectId));
      }
    }
    return out;
  }

  return { request, listAll, modifiedSince, dealPipelines, firstAssociations };
}

export type HubspotClient = ReturnType<typeof hubspotClient>;
