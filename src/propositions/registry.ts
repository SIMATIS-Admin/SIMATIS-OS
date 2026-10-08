import type { z } from 'zod';
import type { Tx } from '../db.js';
import type { Instance } from '../instances/schema.js';

export type ApplyCtx = {
  instance: Instance;
  // False unless real writes are enabled on the server AND for the instance (canWriteReal).
  reel: boolean;
};

export type PropositionType<T> = {
  type: string;
  action: string;
  schema: z.ZodType<T>;
  apply: (tx: Tx, contenu: T, ctx: ApplyCtx) => Promise<unknown>;
};

const types = new Map<string, PropositionType<unknown>>();

// Each business module registers the kinds of proposals it handles (email draft, CRM task…).
export function registerPropositionType<T>(definition: PropositionType<T>): void {
  types.set(definition.type, definition as PropositionType<unknown>);
}

export function getPropositionType(type: string): PropositionType<unknown> {
  const found = types.get(type);
  if (!found) throw new Error(`Type de proposition inconnu : ${type}`);
  return found;
}
