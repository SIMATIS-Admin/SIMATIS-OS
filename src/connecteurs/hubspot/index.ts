import { registerConnector } from '../../connexions/service.js';
import type { Connector, SyncCtx } from '../../connexions/types.js';
import { HubspotError, hubspotClient, type ClientOptions } from './client.js';
import { syncHubspot } from './sync.js';
import { writeHubspot } from './write.js';

const tokenOf = (ctx: SyncCtx) => {
  const token = ctx.secrets.HUBSPOT_TOKEN;
  if (!token) {
    throw new Error(
      `Jeton HubSpot absent : ajouter HUBSPOT_TOKEN dans secrets/instances/${ctx.instance.slug}.env`,
    );
  }
  return token;
};

// Options let tests replace the network (fetch) and the waiting (sleep).
export function hubspotConnector(options: ClientOptions = {}): Connector {
  return {
    fournisseur: 'hubspot',
    sync: (ctx) => syncHubspot(ctx, hubspotClient(tokenOf(ctx), options)),
    write: (ctx, op) => writeHubspot(ctx, op, hubspotClient(tokenOf(ctx), options)),
    verify: async (secrets) => {
      const client = hubspotClient(secrets.HUBSPOT_TOKEN ?? '', { ...options, retries: 1 });
      try {
        await client.request('GET', '/crm/v3/objects/contacts?limit=1');
      } catch (error) {
        throw new Error(
          error instanceof HubspotError && (error.status === 401 || error.status === 403)
            ? 'HubSpot refuse ce jeton : vérifiez qu’il est complet et que l’application privée a accès aux contacts, entreprises, transactions et tâches.'
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
