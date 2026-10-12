import { describe, expect, it } from 'vitest';
import { hubspotClient, personalKeyAuth } from './client.js';

const KEY = 'CiRjbGUtcGVyc29ubmVsbGUtZmljdGl2ZS0wMDAw';

describe('HubSpot personal access key (« mode dégradé »)', () => {
  // Fake exchange endpoint: hands out acces-1, acces-2… valid 30 minutes from the fake clock.
  const setup = () => {
    let clock = 1_000_000;
    const exchanges: unknown[] = [];
    const fetch = (url: string, init: RequestInit) => {
      if (url.endsWith('/localdevauth/v1/auth/refresh')) {
        exchanges.push(JSON.parse(init.body as string));
        return Promise.resolve(
          new Response(
            JSON.stringify({
              oauthAccessToken: `acces-${exchanges.length}`,
              expiresAtMillis: clock + 30 * 60_000,
            }),
          ),
        );
      }
      const auth = (init.headers as Record<string, string>).authorization;
      return Promise.resolve(new Response(JSON.stringify({ auth })));
    };
    return {
      exchanges,
      fetch,
      now: () => clock,
      advance: (ms: number) => (clock += ms),
    };
  };

  it('exchanges the key for an access token, reuses it, and renews it before it expires', async () => {
    const s = setup();
    const auth = personalKeyAuth(KEY, { fetch: s.fetch, now: s.now });
    const client = hubspotClient(auth, { fetch: s.fetch });

    expect(await client.request('GET', '/x')).toEqual({ auth: 'Bearer acces-1' });
    expect(s.exchanges).toEqual([{ encodedOAuthRefreshToken: KEY }]);
    s.advance(20 * 60_000);
    expect(await client.request('GET', '/x')).toEqual({ auth: 'Bearer acces-1' });
    expect(s.exchanges).toHaveLength(1);
    s.advance(6 * 60_000);
    expect(await client.request('GET', '/x')).toEqual({ auth: 'Bearer acces-2' });
    expect(s.exchanges).toHaveLength(2);
  });

  it('reports a refused key as unauthorized, without the key in the message', async () => {
    const fetch = () => Promise.resolve(new Response('{"message":"bad key"}', { status: 400 }));
    const client = hubspotClient(personalKeyAuth(KEY, { fetch }), { fetch });
    const error = await client.request('GET', '/x').catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 401 });
    expect(String((error as Error).message)).not.toContain(KEY);
  });
});
