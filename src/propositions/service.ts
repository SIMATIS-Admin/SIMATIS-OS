import { and, eq } from 'drizzle-orm';
import type { Tx } from '../db.js';
import { currentInstance } from '../db/columns.js';
import type { Instance } from '../instances/schema.js';
import { logEvent } from '../journal/service.js';
import { niveauAction } from './autonomie.js';
import { getPropositionType } from './registry.js';
import { propositions, type Proposition } from './schema.js';

export class PropositionRefusee extends Error {}

export type PropositionCtx = { instance: Instance; realWrites: boolean };

// Double lock: REAL_WRITES=on on the server and ecrituresReelles=true for the instance.
export function canWriteReal(instance: Instance, realWrites: boolean): boolean {
  return realWrites && instance.config.ecrituresReelles === true;
}

async function apply(tx: Tx, ctx: PropositionCtx, p: Proposition, par: string) {
  const definition = getPropositionType(p.type);
  const reel = canWriteReal(ctx.instance, ctx.realWrites);
  try {
    // Savepoint: a failing apply leaves none of its own writes behind.
    const resultat = await tx.transaction((sp) =>
      definition.apply(sp, definition.schema.parse(p.contenu), { instance: ctx.instance, reel }),
    );
    const [row] = await tx
      .update(propositions)
      .set({
        statut: 'appliquee',
        decidePar: par,
        decideAt: new Date(),
        resultat: resultat ?? null,
        updatedAt: new Date(),
      })
      .where(eq(propositions.id, p.id))
      .returning();
    await logEvent(tx, {
      acteur: par,
      action: `Proposition appliquée${reel ? '' : ' (simulation)'} : ${p.type}`,
      niveau: p.niveau,
      details: { proposition: p.id },
    });
    return row ?? p;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const [row] = await tx
      .update(propositions)
      .set({
        statut: 'echec',
        decidePar: par,
        decideAt: new Date(),
        resultat: { erreur: message },
        updatedAt: new Date(),
      })
      .where(eq(propositions.id, p.id))
      .returning();
    await logEvent(tx, {
      acteur: par,
      action: `Échec de la proposition : ${p.type}`,
      niveau: p.niveau,
      details: { proposition: p.id, erreur: message },
    });
    return row ?? p;
  }
}

export async function propose(
  tx: Tx,
  ctx: PropositionCtx,
  input: { type: string; contenu: unknown; auteur: string },
): Promise<Proposition> {
  const definition = getPropositionType(input.type);
  const contenu = definition.schema.parse(input.contenu);
  const niveau = await niveauAction(tx, definition.action);
  if (niveau === 'interdit' || niveau === 'L0') {
    throw new PropositionRefusee(
      `Action « ${definition.action} » non autorisée (${niveau === 'L0' ? 'L0 : suggestion seulement' : 'interdite'}).`,
    );
  }

  const [created] = await tx
    .insert(propositions)
    .values({
      instanceId: currentInstance,
      type: input.type,
      contenu,
      auteur: input.auteur,
      niveau,
    })
    .returning();
  if (!created) throw new Error('Proposition non créée');
  await logEvent(tx, {
    acteur: input.auteur,
    action: `Proposition créée : ${input.type}`,
    niveau,
    details: { proposition: created.id },
  });

  // L3: the OS executes on its own. L1 and L2 wait for the pilot's decision.
  return niveau === 'L3' ? apply(tx, ctx, created, 'os') : created;
}

export async function decide(
  tx: Tx,
  ctx: PropositionCtx,
  id: string,
  { decision, par, contenu }: { decision: 'valider' | 'ecarter'; par: string; contenu?: unknown },
): Promise<Proposition> {
  const [p] = await tx
    .select()
    .from(propositions)
    .where(and(eq(propositions.instanceId, currentInstance), eq(propositions.id, id)));
  if (!p) throw new Error('Proposition introuvable');
  if (p.statut !== 'proposee') throw new Error(`Proposition déjà traitée (${p.statut})`);
  if (par === p.auteur) {
    throw new PropositionRefusee('Une proposition ne peut pas être validée par son auteur.');
  }

  if (decision === 'ecarter') {
    const [row] = await tx
      .update(propositions)
      .set({ statut: 'ecartee', decidePar: par, decideAt: new Date(), updatedAt: new Date() })
      .where(eq(propositions.id, id))
      .returning();
    await logEvent(tx, {
      acteur: par,
      action: `Proposition écartée : ${p.type}`,
      niveau: p.niveau,
      details: { proposition: id },
    });
    return row ?? p;
  }

  let current = p;
  if (contenu !== undefined) {
    const parsed = getPropositionType(p.type).schema.parse(contenu);
    const [row] = await tx
      .update(propositions)
      .set({ contenu: parsed, updatedAt: new Date() })
      .where(eq(propositions.id, id))
      .returning();
    current = row ?? p;
    await logEvent(tx, {
      acteur: par,
      action: `Proposition modifiée avant validation : ${p.type}`,
      niveau: p.niveau,
      details: { proposition: id },
    });
  }
  return apply(tx, ctx, current, par);
}
