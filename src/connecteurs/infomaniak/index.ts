import { registerConnector } from '../../connexions/service.js';
import type { Connector } from '../../connexions/types.js';
import { createDraft, verifier } from './imap.js';

const VIDE = { lus: 0, crees: 0, maj: 0, erreurs: [] };

// Infomaniak mailbox over IMAP: nothing is copied; a "sync" checks that the device password
// still works. The one write is a draft, never a sent email.
export function infomaniakConnector(): Connector {
  return {
    fournisseur: 'infomaniak',
    sync: async (ctx) => {
      await verifier(ctx.secrets, ctx.instance.nom);
      return VIDE;
    },
    write: async (ctx, op) => {
      if (op.op !== 'draft.create')
        throw new Error(`Écriture de messagerie non prise en charge : ${op.op}`);
      const { to, subject, html } = op.data as { to: string; subject: string; html: string };
      const result = await createDraft(ctx, { to, subject, html });
      return { simulation: result.simulation, ...(result.draftId ? { id: result.draftId } : {}) };
    },
    verify: (secrets) => verifier(secrets),
  };
}

registerConnector(infomaniakConnector());
