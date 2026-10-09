import { and, eq, inArray } from 'drizzle-orm';
import { exchangeCode, googleAuthUrl, pkce, type FetchLike } from '../connecteurs/google/oauth.js';
import type { Database, Tx } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { loadInstanceSecrets, writeGoogleToken, writeInstanceSecret } from '../secrets.js';
import { connexions } from './schema.js';
import { configureConnexion, registeredConnector } from './service.js';

// Connecting an instance's tools from Paramètres > Connexions, without a terminal: secrets go to
// secrets/instances/<slug>.env (never to the database, never back to the browser).

export class BranchementRefuse extends Error {}

const HUBSPOT_TOKEN = /^[A-Za-z0-9_-]{20,200}$/;

// Checks the private-app token against HubSpot, saves it, and mirrors the CRM read-only.
export async function brancherHubspot(
  db: Database,
  instance: Instance,
  token: string,
  secretsDir: string,
): Promise<void> {
  const jeton = token.trim();
  if (!HUBSPOT_TOKEN.test(jeton)) {
    throw new BranchementRefuse('Ce texte ne ressemble pas à un jeton HubSpot (pat-…).');
  }
  const connector = registeredConnector('hubspot');
  try {
    await connector?.verify?.({ HUBSPOT_TOKEN: jeton });
  } catch (error) {
    throw new BranchementRefuse(error instanceof Error ? error.message : String(error));
  }
  await writeInstanceSecret(secretsDir, instance.slug, 'HUBSPOT_TOKEN', jeton);
  await withInstance(db, instance.id, (tx) =>
    configureConnexion(tx, {
      kind: 'crm',
      fournisseur: 'hubspot',
      reglages: { frequence: '15min', sens: 'lecture' },
    }),
  );
}

// Gmail and Agenda of the instance, once Google has granted access (CLI or web consent).
export async function brancherGoogle(tx: Tx): Promise<void> {
  const existing = await tx
    .select({ kind: connexions.kind, fournisseur: connexions.fournisseur })
    .from(connexions)
    .where(eq(connexions.instanceId, currentInstance));
  const fournisseur = new Map(existing.map((c) => [c.kind, c.fournisseur]));
  if (fournisseur.get('messagerie') !== 'gmail') {
    await configureConnexion(tx, {
      kind: 'messagerie',
      fournisseur: 'gmail',
      reglages: { frequence: 'manuel', historiqueMois: 12, contenu: 'extraits' },
    });
  }
  if (fournisseur.get('agenda') !== 'google-agenda') {
    await configureConnexion(tx, {
      kind: 'agenda',
      fournisseur: 'google-agenda',
      reglages: { frequence: 'manuel', calendriers: ['primary'], tamponMin: 15 },
    });
  }
  await tx
    .update(connexions)
    .set({ etat: 'ok', derniereErreur: null, updatedAt: new Date() })
    .where(
      and(
        eq(connexions.instanceId, currentInstance),
        inArray(connexions.kind, ['messagerie', 'agenda']),
      ),
    );
}

type GoogleClient = { clientId: string; clientSecret: string };
type Pending = GoogleClient & {
  slug: string;
  verifier: string;
  redirectUri: string;
  expires: number;
};

const PENDING_MS = 10 * 60_000;

// Web consent: start() returns Google's consent URL, finish() is called by the redirect back to
// the OS. Pending consents live in memory for ten minutes, keyed by their one-time state.
export function googleWebFlow(deps: {
  secretsDir: string;
  defaultClient?: GoogleClient;
  fetch?: FetchLike;
}) {
  const pending = new Map<string, Pending>();
  const doFetch: FetchLike = deps.fetch ?? ((url, init) => fetch(url, init));

  async function clientOf(slug: string): Promise<GoogleClient | null> {
    const secrets = await loadInstanceSecrets(deps.secretsDir, slug);
    if (secrets.GOOGLE_CLIENT_ID && secrets.GOOGLE_CLIENT_SECRET) {
      return { clientId: secrets.GOOGLE_CLIENT_ID, clientSecret: secrets.GOOGLE_CLIENT_SECRET };
    }
    return deps.defaultClient ?? null;
  }

  return {
    // False until the OS has a Google OAuth client (set once in .env, never by the pilot).
    async clientDisponible(slug: string): Promise<boolean> {
      return (await clientOf(slug)) !== null;
    },

    async start(slug: string, redirectUri: string): Promise<string> {
      const client = await clientOf(slug);
      if (!client) {
        throw new BranchementRefuse(
          'La connexion Google n’est pas encore activée sur cet OS (identifiant OAuth à poser une fois dans .env).',
        );
      }
      const now = Date.now();
      for (const [key, p] of pending) if (p.expires < now) pending.delete(key);
      const { verifier, challenge, state } = pkce();
      pending.set(state, { ...client, slug, verifier, redirectUri, expires: now + PENDING_MS });
      return googleAuthUrl({ clientId: client.clientId, redirectUri, state, challenge });
    },

    // Returns the slug of the instance whose consent came back.
    async finish(
      db: Database,
      instanceOf: (slug: string) => Promise<Instance | null>,
      params: { state?: string; code?: string; error?: string },
    ): Promise<string> {
      const p = params.state ? pending.get(params.state) : undefined;
      if (params.state) pending.delete(params.state);
      if (!p || p.expires < Date.now()) {
        throw new BranchementRefuse('Demande de connexion expirée : recommencez.');
      }
      if (params.error || !params.code) {
        throw new BranchementRefuse(
          `Autorisation refusée par Google (${params.error ?? 'sans code'}).`,
        );
      }
      const instance = await instanceOf(p.slug);
      if (!instance) throw new BranchementRefuse(`Instance inconnue ou archivée : ${p.slug}`);
      const token = await exchangeCode(
        {
          clientId: p.clientId,
          clientSecret: p.clientSecret,
          code: params.code,
          verifier: p.verifier,
          redirectUri: p.redirectUri,
        },
        doFetch,
      );
      await writeInstanceSecret(deps.secretsDir, p.slug, 'GOOGLE_CLIENT_ID', p.clientId);
      await writeInstanceSecret(deps.secretsDir, p.slug, 'GOOGLE_CLIENT_SECRET', p.clientSecret);
      await writeGoogleToken(deps.secretsDir, p.slug, token);
      await withInstance(db, instance.id, brancherGoogle);
      return p.slug;
    },
  };
}
