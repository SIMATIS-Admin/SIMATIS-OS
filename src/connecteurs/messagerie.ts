import type { SyncCtx } from '../connexions/types.js';
import * as gmail from './google/google.js';
import type { Brouillon, Fil, Message } from './google/google.js';
import * as imap from './infomaniak/imap.js';

// What the OS reads in an instance's mailbox, whoever hosts it (Gmail by OAuth, Infomaniak by
// IMAP). The one write, a draft, goes through the connector (connexions/service.ts writeVia).
export type Messagerie = {
  historique(email: string, o: { mois: number; complet?: boolean }): Promise<Message[]>;
  filsRecents(jours: number): Promise<Fil[]>;
  brouillons(): Promise<Brouillon[]>;
  // Address of the connected mailbox: tells the pilot's own messages from the others.
  compte(): Promise<string>;
  // Where the pilot opens a thread; Gmail's own link when absent.
  lienFil?: (threadId: string) => string;
};

export const MESSAGERIES = ['gmail', 'infomaniak'];

export function messagerieDe(
  fournisseur: string,
  ctx: Pick<SyncCtx, 'secrets' | 'instance'>,
): Messagerie {
  if (fournisseur === 'infomaniak') {
    return {
      historique: (email, o) => imap.historique(ctx, email, o),
      filsRecents: (jours) => imap.filsRecents(ctx, jours),
      brouillons: () => imap.brouillons(ctx),
      compte: () => Promise.resolve((ctx.secrets.IMAP_USER ?? '').toLowerCase()),
      // Infomaniak's webmail has no address for one message.
      lienFil: () => 'https://mail.infomaniak.com/',
    };
  }
  return {
    historique: (email, o) => gmail.historique(ctx, email, o),
    filsRecents: (jours) => gmail.filsRecents(ctx, jours),
    brouillons: () => gmail.brouillons(ctx),
    compte: () => gmail.compteGmail(ctx),
  };
}
