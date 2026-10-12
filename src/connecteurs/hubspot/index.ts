import { registerConnector } from '../../connexions/service.js';
import type { Connector, SyncCtx } from '../../connexions/types.js';
import {
  HubspotError,
  hubspotClient,
  personalKeyAuth,
  type ClientOptions,
  type HubspotAuth,
} from './client.js';
import { syncHubspot } from './sync.js';
import { writeHubspot } from './write.js';

// Options let tests replace the network (fetch) and the waiting (sleep).
export function hubspotConnector(options: ClientOptions = {}): Connector {
  // One provider per personal key, so its access token is reused across syncs.
  const personal = new Map<string, () => Promise<string>>();
  const authOf = (secrets: Record<string, string>): HubspotAuth | null => {
    if (secrets.HUBSPOT_TOKEN) return secrets.HUBSPOT_TOKEN;
    const key = secrets.HUBSPOT_PERSONAL_KEY;
    if (!key) return null;
    let provider = personal.get(key);
    if (!provider) {
      provider = personalKeyAuth(key, options);
      personal.set(key, provider);
    }
    return provider;
  };
  const required = (ctx: SyncCtx) => {
    const auth = authOf(ctx.secrets);
    if (!auth) {
      throw new Error(
        `Jeton HubSpot absent : ajouter HUBSPOT_TOKEN dans secrets/instances/${ctx.instance.slug}.env (ou HUBSPOT_PERSONAL_KEY en mode dégradé)`,
      );
    }
    return auth;
  };
  return {
    fournisseur: 'hubspot',
    sync: (ctx) => syncHubspot(ctx, hubspotClient(required(ctx), options)),
    write: (ctx, op) => writeHubspot(ctx, op, hubspotClient(required(ctx), options)),
    verify: async (secrets) => {
      const degrade = !secrets.HUBSPOT_TOKEN && !!secrets.HUBSPOT_PERSONAL_KEY;
      const client = hubspotClient(authOf(secrets) ?? '', { ...options, retries: 1 });
      try {
        await client.request('GET', '/crm/v3/objects/contacts?limit=1');
      } catch (error) {
        throw new Error(
          error instanceof HubspotError && (error.status === 401 || error.status === 403)
            ? degrade
              ? 'HubSpot refuse cette clé personnelle : vérifiez qu’elle est complète et qu’elle a accès aux contacts, entreprises, transactions et tâches (CRM).'
              : 'HubSpot refuse ce jeton : vérifiez qu’il est complet et que l’application privée a accès aux contacts, entreprises, transactions et tâches.'
            : error instanceof Error
              ? error.message
              : String(error),
          { cause: error },
        );
      }
    },
  };
}

registerConnector(hubspotConnector());
