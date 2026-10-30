import { registerConnector } from '../../connexions/service.js';
import type { Connector } from '../../connexions/types.js';
import {
  createDraft,
  googleApi,
  sendMessage,
  type GoogleOptions,
  type ImageIntegree,
} from './google.js';

const VIDE = { lus: 0, crees: 0, maj: 0, erreurs: [] };

// Gmail: nothing is copied for now; a "sync" checks that the authorization still works. The writes
// are a draft (résultat VMA) and, for the invitation au test VMA, a message sent directly.
export function gmailConnector(options: GoogleOptions = {}): Connector {
  return {
    fournisseur: 'gmail',
    sync: async (ctx) => {
      await googleApi(ctx, options).check();
      return VIDE;
    },
    write: async (ctx, op) => {
      const { to, subject, html, images, threadId } = op.data as {
        to: string;
        subject: string;
        html: string;
        images?: ImageIntegree[];
        threadId?: string;
      };
      if (op.op === 'message.send') {
        const result = await sendMessage(
          ctx,
          { to, subject, html, ...(images ? { images } : {}), ...(threadId ? { threadId } : {}) },
          options,
        );
        return { simulation: result.simulation };
      }
      if (op.op !== 'draft.create')
        throw new Error(`Écriture Gmail non prise en charge : ${op.op}`);
      const result = await createDraft(
        ctx,
        { to, subject, html, ...(images ? { images } : {}), ...(threadId ? { threadId } : {}) },
        options,
      );
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
