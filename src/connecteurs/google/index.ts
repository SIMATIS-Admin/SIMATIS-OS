import { registerConnector } from '../../connexions/service.js';
import type { Connector } from '../../connexions/types.js';
import { createDraft, googleApi, type GoogleOptions } from './google.js';

const VIDE = { lus: 0, crees: 0, maj: 0, erreurs: [] };

// Gmail: nothing is copied for now; a "sync" checks that the authorization still works. The one
// write is a draft, never a sent email.
export function gmailConnector(options: GoogleOptions = {}): Connector {
  return {
    fournisseur: 'gmail',
    sync: async (ctx) => {
      await googleApi(ctx, options).check();
      return VIDE;
    },
    write: async (ctx, op) => {
      if (op.op !== 'draft.create')
        throw new Error(`Écriture Gmail non prise en charge : ${op.op}`);
      const { to, subject, html } = op.data as { to: string; subject: string; html: string };
      const result = await createDraft(ctx, { to, subject, html }, options);
      return { simulation: result.simulation, ...(result.draftId ? { id: result.draftId } : {}) };
    },
  };
}

export function agendaConnector(options: GoogleOptions = {}): Connector {
  return {
    fournisseur: 'google-agenda',
    sync: async (ctx) => {
      await googleApi(ctx, options).check();
      return VIDE;
    },
  };
}

registerConnector(gmailConnector());
registerConnector(agendaConnector());
