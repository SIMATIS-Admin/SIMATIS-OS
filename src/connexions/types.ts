import type { Tx } from '../db.js';
import type { Instance } from '../instances/schema.js';
import type { Reglages } from './schema.js';

export type SyncCtx = {
  instance: Instance;
  tx: Tx;
  secrets: Record<string, string>;
  reglages: Reglages;
  connexionId: string;
  // Last successful sync, null on the first pass (full history).
  derniereSynchro: Date | null;
  // False unless both real-write locks are on (see propositions/service.ts canWriteReal).
  reel: boolean;
};

export type SyncReport = { lus: number; crees: number; maj: number; erreurs: string[] };

export type WriteOp = { op: string; data: Record<string, unknown> };
export type WriteResult = { simulation: boolean } & Record<string, unknown>;

export interface Connector {
  fournisseur: string;
  sync(ctx: SyncCtx): Promise<SyncReport>;
  write?(ctx: SyncCtx, op: WriteOp): Promise<WriteResult>;
  // Checks credentials before they are saved (Paramètres > Connexions); throws a readable error.
  verify?(secrets: Record<string, string>): Promise<void>;
}
