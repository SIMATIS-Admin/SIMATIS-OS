import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export const SCOPES = [
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
  // Granted now so that creating meetings later never forces every mailbox to reconnect;
  // unused until a write is added, and then behind the real-write locks.
  'https://www.googleapis.com/auth/calendar.events',
];

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export class GoogleError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
type Client = { clientId: string; clientSecret: string };

async function tokenRequest(params: Record<string, string>, fetch: FetchLike) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, string | undefined>;
  if (!response.ok) {
    throw new GoogleError(
      `Google a refusé l'autorisation (${response.status}${body.error ? ` : ${body.error}` : ''})`,
      response.status,
    );
  }
  return body;
}

export async function accessToken(
  { clientId, clientSecret, refreshToken }: Client & { refreshToken: string },
  fetch: FetchLike,
): Promise<string> {
  const body = await tokenRequest(
    {
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    },
    fetch,
  );
  if (!body.access_token) throw new GoogleError('Google n’a pas renvoyé de jeton d’accès', 502);
  return body.access_token;
}

const base64url = (b: Buffer) => b.toString('base64url');

// PKCE pair and anti-forgery state for one consent.
export function pkce() {
  const verifier = base64url(randomBytes(32));
  return {
    verifier,
    challenge: base64url(createHash('sha256').update(verifier).digest()),
    state: base64url(randomBytes(16)),
  };
}

export function googleAuthUrl(p: {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}): string {
  return `${AUTH_URL}?${new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state: p.state,
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
  }).toString()}`;
}

export async function exchangeCode(
  p: Client & { code: string; verifier: string; redirectUri: string },
  fetch: FetchLike,
): Promise<{ refresh_token: string; scope: string }> {
  const body = await tokenRequest(
    {
      client_id: p.clientId,
      client_secret: p.clientSecret,
      code: p.code,
      code_verifier: p.verifier,
      redirect_uri: p.redirectUri,
      grant_type: 'authorization_code',
    },
    fetch,
  );
  if (!body.refresh_token) {
    throw new GoogleError('Google n’a pas renvoyé de jeton de rafraîchissement', 502);
  }
  return { refresh_token: body.refresh_token, scope: body.scope ?? SCOPES.join(' ') };
}

// One-time consent on the workstation (google:connect): a loopback redirect to a local server,
// with PKCE and a state check. Returns the refresh token to store in the instance's secrets.
export async function connectGoogle({
  clientId,
  clientSecret,
  open,
  fetch,
  timeoutMs = 5 * 60_000,
}: Client & {
  open: (url: string) => void;
  fetch: FetchLike;
  timeoutMs?: number;
}): Promise<{ refresh_token: string; scope: string }> {
  const { verifier, challenge, state } = pkce();

  let settle: { ok: (code: string) => void; ko: (e: Error) => void } | undefined;
  const code = new Promise<string>((ok, ko) => (settle = { ok, ko }));
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/oauth2callback') {
      res.writeHead(404).end();
      return;
    }
    const page = (text: string) =>
      res
        .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        .end(`<!doctype html><meta charset="utf-8"><p>${text}</p>`);
    if (url.searchParams.get('state') !== state) {
      page('Réponse inattendue : relancez google:connect.');
      settle?.ko(new GoogleError('Réponse OAuth refusée (state différent)', 400));
    } else if (url.searchParams.get('error')) {
      page('Autorisation refusée.');
      settle?.ko(new GoogleError(`Autorisation refusée : ${url.searchParams.get('error')}`, 403));
    } else {
      page('Connexion réussie : vous pouvez fermer cette page.');
      settle?.ok(url.searchParams.get('code') ?? '');
    }
  });

  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/oauth2callback`;
  const timer = setTimeout(
    () => settle?.ko(new GoogleError('Délai dépassé : aucune autorisation reçue', 408)),
    timeoutMs,
  );
  try {
    open(googleAuthUrl({ clientId, redirectUri, state, challenge }));
    return await exchangeCode(
      { clientId, clientSecret, code: await code, verifier, redirectUri },
      fetch,
    );
  } finally {
    clearTimeout(timer);
    server.close();
  }
}
