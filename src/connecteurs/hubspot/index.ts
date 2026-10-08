import { registerConnector } from '../../connexions/service.js';
import type { Connector, SyncCtx } from '../../connexions/types.js';
import { hubspotClient, type ClientOptions } from './client.js';
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
  };
}

registerConnector(hubspotConnector());
