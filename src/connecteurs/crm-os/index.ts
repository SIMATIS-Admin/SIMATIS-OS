import { registerConnector } from '../../connexions/service.js';
import type { Connector, SyncCtx } from '../../connexions/types.js';
import { crmOsClient, CrmOsError, type OptionsClient } from './client.js';
import { syncCrmOs } from './sync.js';

// The compatible CRM (its own application, same data model as the OS): the OS mirrors it.
// Secrets of the instance: CRM_OS_URL and CRM_OS_TOKEN (secrets/instances/<slug>.env).
// No `write`: read only for now.
export function crmOsConnector(options: OptionsClient = {}): Connector {
  const clientOf = (secrets: Record<string, string>) => {
    if (!secrets.CRM_OS_URL || !secrets.CRM_OS_TOKEN) {
      throw new CrmOsError(
        'Accès au CRM compatible absent : renseigner CRM_OS_URL et CRM_OS_TOKEN dans le fichier de secrets de l’instance',
      );
    }
    return crmOsClient(secrets, options);
  };
  return {
    fournisseur: 'crm-os',
    sync: (ctx: SyncCtx) => syncCrmOs(ctx, clientOf(ctx.secrets)),
    verify: (secrets) => clientOf(secrets).verifier(),
  };
}

registerConnector(crmOsConnector());
