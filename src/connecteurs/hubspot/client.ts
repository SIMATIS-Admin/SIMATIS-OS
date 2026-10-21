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
const BASE_URL = 'https://api.hubapi.com';

// A fixed private-app token, or a provider that hands out short-lived access tokens.
export type HubspotAuth = string | (() => Promise<string>);

// « Connexion en mode dégradé » : when the client's HubSpot admin grants no private app or service
// key, the user's own personal access key is exchanged for a ~30 min access token, the way the
// HubSpot CLI does it (localdevauth endpoint, not part of the public API). The token is cached and
// renewed a few minutes before it expires. The key never appears in an error message.
export function personalKeyAuth(
  key: string,
  options: Pick<ClientOptions, 'fetch' | 'baseUrl'> & { now?: () => number } = {},
): () => Promise<string> {
  const doFetch = options.fetch ?? ((url, init) => fetch(url, init));
  const now = options.now ?? Date.now;
  let cached: { token: string; expiresAt: number } | null = null;
  return async () => {
    if (cached && cached.expiresAt - 5 * 60_000 > now()) return cached.token;
    let response: Response;
    try {
      response = await doFetch(`${options.baseUrl ?? BASE_URL}/localdevauth/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ encodedOAuthRefreshToken: key }),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new HubspotError(`HubSpot injoignable : ${reason}`, 0);
    }
    if (!response.ok) {
      throw new HubspotError(
        `HubSpot refuse la clé personnelle (${response.status})`,
        response.status === 400 ? 401 : response.status,
      );
    }
    const body = (await response.json()) as { oauthAccessToken?: string; expiresAtMillis?: number };
    if (!body.oauthAccessToken) {
      throw new HubspotError('HubSpot n’a pas renvoyé de jeton pour la clé personnelle', 502);
    }
    cached = {
      token: body.oauthAccessToken,
      expiresAt: body.expiresAtMillis ?? now() + 30 * 60_000,
    };
    return cached.token;
  };
}

// Client for the HubSpot CRM v3 API. Retries rate limits (429) and server errors with exponential
// backoff, then raises HubspotError. The token never appears in an error message.
export function hubspotClient(auth: HubspotAuth, options: ClientOptions = {}) {
  const doFetch = options.fetch ?? ((url, init) => fetch(url, init));
  const sleep = options.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const baseUrl = options.baseUrl ?? BASE_URL;
  const retries = options.retries ?? 3;

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      // Asked on every attempt: a long first sync can outlive a personal-key access token.
      const token = typeof auth === 'string' ? auth : await auth();
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
  // Every association from `from` records to `to` objects, in the order HubSpot returns them.
  async function allAssociations(
    from: string,
    to: string,
    ids: string[],
  ): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    for (let i = 0; i < ids.length; i += 1000) {
      const chunk = ids.slice(i, i + 1000);
      const result = await request<{
        results: { from: { id: string }; to: { toObjectId: string | number }[] }[];
      }>('POST', `/crm/v4/associations/${from}/${to}/batch/read`, {
        inputs: chunk.map((id) => ({ id })),
      });
      for (const r of result.results) {
        if (r.to.length > 0)
          out.set(
            r.from.id,
            r.to.map((x) => String(x.toObjectId)),
          );
      }
    }
    return out;
  }

  async function firstAssociations(
    from: string,
    to: string,
    ids: string[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const [id, cibles] of await allAssociations(from, to, ids)) {
      const first = cibles[0];
      if (first) out.set(id, first);
    }
    return out;
  }

  return { request, listAll, modifiedSince, dealPipelines, firstAssociations, allAssociations };
}

export type HubspotClient = ReturnType<typeof hubspotClient>;
