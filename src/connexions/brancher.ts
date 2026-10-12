import { and, eq, inArray } from 'drizzle-orm';
import {
  clientSecretValide,
  exchangeCode,
  GOOGLE_CLIENT_ID_APP,
  googleAuthUrl,
  pkce,
  type FetchLike,
} from '../connecteurs/google/oauth.js';
import { MESSAGERIES } from '../connecteurs/messagerie.js';
import type { Database, Tx } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import {
  loadInstanceSecrets,
  removeInstanceSecret,
  writeGoogleAppSecret,
  writeGoogleToken,
  writeImapAccount,
  writeInstanceSecret,
  type CompteImap,
} from '../secrets.js';
import { connexions } from './schema.js';
import { configureConnexion, registeredConnector } from './service.js';

// Connecting an instance's tools from Paramètres > Connexions, without a terminal: secrets go to
// secrets/instances/<slug>.env (never to the database, never back to the browser).

export class BranchementRefuse extends Error {}

const HUBSPOT_TOKEN = /^[A-Za-z0-9_-]{20,200}$/;
// Personal access keys are longer and base64-encoded.
const HUBSPOT_PERSONAL_KEY = /^[A-Za-z0-9_+/=-]{20,1000}$/;

// « standard » : private-app (or service) token from the client's admin. « degrade » : the user's
// own personal access key, when the client grants nothing else (see personalKeyAuth).
export type ModeHubspot = 'standard' | 'degrade';

// Checks the credential against HubSpot, saves it (replacing the other kind, if any), and mirrors
// the CRM read-only.
export async function brancherHubspot(
  db: Database,
  instance: Instance,
  token: string,
  secretsDir: string,
  mode: ModeHubspot = 'standard',
): Promise<void> {
  const jeton = token.trim();
  const degrade = mode === 'degrade';
  if (!(degrade ? HUBSPOT_PERSONAL_KEY : HUBSPOT_TOKEN).test(jeton)) {
    throw new BranchementRefuse(
      degrade
        ? 'Ce texte ne ressemble pas à une clé personnelle HubSpot.'
        : 'Ce texte ne ressemble pas à un jeton HubSpot (pat-…).',
    );
  }
  const [cle, autre] = degrade
    ? ['HUBSPOT_PERSONAL_KEY', 'HUBSPOT_TOKEN']
    : ['HUBSPOT_TOKEN', 'HUBSPOT_PERSONAL_KEY'];
  const connector = registeredConnector('hubspot');
  try {
    await connector?.verify?.({ [cle]: jeton });
  } catch (error) {
    throw new BranchementRefuse(error instanceof Error ? error.message : String(error));
  }
  await writeInstanceSecret(secretsDir, instance.slug, cle, jeton);
  await removeInstanceSecret(secretsDir, instance.slug, autre);
  await withInstance(db, instance.id, (tx) =>
    configureConnexion(tx, {
      kind: 'crm',
      fournisseur: 'hubspot',
      reglages: { frequence: '15min', sens: 'lecture' },
    }),
  );
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Checks the address and its device password with the mailbox, saves them, and makes this
// mailbox the instance's messaging. The agenda is left as it is. `serveur` is only for a mailbox
// hosted elsewhere than Infomaniak.
export async function brancherInfomaniak(
  db: Database,
  instance: Instance,
  compte: { email: string; motDePasse: string },
  secretsDir: string,
  serveur: Pick<CompteImap, 'host' | 'port' | 'secure'> = {},
): Promise<void> {
  const user = compte.email.trim().toLowerCase();
  const password = compte.motDePasse.trim();
  if (!EMAIL.test(user)) throw new BranchementRefuse("Cette adresse email n'est pas valide.");
  if (!password) throw new BranchementRefuse("Mot de passe d'appareil manquant.");
  const c: CompteImap = { user, password, ...serveur };
  try {
    await registeredConnector('infomaniak')?.verify?.({
      IMAP_USER: user,
      IMAP_PASSWORD: password,
      ...(c.host ? { IMAP_HOST: c.host } : {}),
      ...(c.port ? { IMAP_PORT: String(c.port) } : {}),
      ...(c.secure === false ? { IMAP_SECURE: 'non' } : {}),
    });
  } catch (error) {
    throw new BranchementRefuse(error instanceof Error ? error.message : String(error));
  }
  await writeImapAccount(secretsDir, instance.slug, c);
  await withInstance(db, instance.id, async (tx) => {
    const [actuelle] = await tx
      .select({ fournisseur: connexions.fournisseur, reglages: connexions.reglages })
      .from(connexions)
      .where(and(eq(connexions.instanceId, currentInstance), eq(connexions.kind, 'messagerie')));
    await configureConnexion(tx, {
      kind: 'messagerie',
      fournisseur: 'infomaniak',
      reglages:
        actuelle && MESSAGERIES.includes(actuelle.fournisseur)
          ? actuelle.reglages
          : { frequence: 'manuel', historiqueMois: 12, contenu: 'extraits' },
    });
  });
}

// Gmail and Agenda of the instance, once Google has granted access (CLI or web consent). An
// Infomaniak mailbox stays the instance's messaging: Google then brings the agenda only.
export async function brancherGoogle(tx: Tx): Promise<void> {
  const existing = await tx
    .select({ kind: connexions.kind, fournisseur: connexions.fournisseur })
    .from(connexions)
    .where(eq(connexions.instanceId, currentInstance));
  const fournisseur = new Map(existing.map((c) => [c.kind, c.fournisseur]));
  const infomaniak = fournisseur.get('messagerie') === 'infomaniak';
  if (!infomaniak && fournisseur.get('messagerie') !== 'gmail') {
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
        inArray(connexions.kind, infomaniak ? ['agenda'] : ['messagerie', 'agenda']),
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
export function googleWebFlow(deps: { secretsDir: string; fetch?: FetchLike }) {
  const pending = new Map<string, Pending>();
  const doFetch: FetchLike = deps.fetch ?? ((url, init) => fetch(url, init));

  async function clientOf(slug: string): Promise<GoogleClient | null> {
    const secrets = await loadInstanceSecrets(deps.secretsDir, slug);
    if (secrets.GOOGLE_CLIENT_ID && secrets.GOOGLE_CLIENT_SECRET) {
      return { clientId: secrets.GOOGLE_CLIENT_ID, clientSecret: secrets.GOOGLE_CLIENT_SECRET };
    }
    return null;
  }

  return {
    // False until the OS's Google client secret has been pasted once.
    async clientDisponible(slug: string): Promise<boolean> {
      return (await clientOf(slug)) !== null;
    },

    // Saves the OS's Google client secret after checking it with Google.
    async enregistrerSecret(secret: string): Promise<void> {
      const valeur = secret.trim();
      if (!/^[A-Za-z0-9_-]{10,100}$/.test(valeur)) {
        throw new BranchementRefuse(
          'Ce texte ne ressemble pas à un code secret Google (GOCSPX-…).',
        );
      }
      let valide: boolean;
      try {
        valide = await clientSecretValide(GOOGLE_CLIENT_ID_APP, valeur, doFetch);
      } catch {
        throw new BranchementRefuse('Google injoignable : vérifiez la connexion internet.');
      }
      if (!valide)
        throw new BranchementRefuse('Google refuse ce code secret : recopiez-le en entier.');
      await writeGoogleAppSecret(deps.secretsDir, valeur);
    },

    async start(slug: string, redirectUri: string): Promise<string> {
      const client = await clientOf(slug);
      if (!client) {
        throw new BranchementRefuse(
          'Code secret Google de l’OS manquant : enregistrez-le dans Paramètres > Connexions.',
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
      await writeGoogleToken(deps.secretsDir, p.slug, token);
      await withInstance(db, instance.id, brancherGoogle);
      return p.slug;
    },
  };
}
