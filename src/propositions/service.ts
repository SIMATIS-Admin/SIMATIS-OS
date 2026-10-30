import { and, eq } from 'drizzle-orm';
import type { Tx } from '../db.js';
import { currentInstance } from '../db/columns.js';
import type { Instance } from '../instances/schema.js';
import { cloreSujetProposition, sujetPourProposition } from '../inbox/depot.js';
import { logEvent } from '../journal/service.js';
import { niveauAction, type Niveau } from './autonomie.js';
import { getPropositionType, type ApplyCtx } from './registry.js';
import { propositions, type Proposition } from './schema.js';

export class PropositionRefusee extends Error {}

export type PropositionCtx = { instance: Instance; realWrites: boolean; secretsDir?: string };

// Double lock: REAL_WRITES=on on the server and ecrituresReelles=true for the instance.
export function canWriteReal(instance: Instance, realWrites: boolean): boolean {
  // A prospect (demo) instance never writes to a real tool, whatever its config says.
  return realWrites && instance.type !== 'prospect' && instance.config.ecrituresReelles === true;
}

const applyCtx = (ctx: PropositionCtx, p: Proposition): ApplyCtx => ({
  instance: ctx.instance,
  reel: canWriteReal(ctx.instance, ctx.realWrites),
  deps: { secretsDir: ctx.secretsDir ?? './secrets/instances', realWrites: ctx.realWrites },
  proposition: { id: p.id, auteur: p.auteur },
});

async function apply(tx: Tx, ctx: PropositionCtx, p: Proposition, par: string) {
  const definition = getPropositionType(p.type);
  const reel = canWriteReal(ctx.instance, ctx.realWrites);
  try {
    // Savepoint: a failing apply leaves none of its own writes behind.
    const resultat = await tx.transaction((sp) =>
      definition.apply(sp, definition.schema.parse(p.contenu), applyCtx(ctx, p)),
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
  // `niveau`: set by the module instead of the action's autonomy, for what the pilot decides
  // anyway (a mission received from a partner follows the level of that connection).
  input: { type: string; contenu: unknown; auteur: string; niveau?: Niveau },
): Promise<Proposition> {
  const definition = getPropositionType(input.type);
  const contenu = definition.schema.parse(input.contenu);
  const niveau = input.niveau ?? (await niveauAction(tx, definition.action));
  if (niveau === 'interdit' || (niveau === 'L0' && !input.niveau)) {
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

  // L3: the OS executes on its own. L1 and L2 wait for the pilot's decision, in the Inbox.
  if (niveau === 'L3') return apply(tx, ctx, created, 'os');
  await sujetPourProposition(tx, created);
  return created;
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
    const { ecarter, schema } = getPropositionType(p.type);
    if (ecarter) {
      await tx.transaction((sp) => ecarter(sp, schema.parse(p.contenu), applyCtx(ctx, p)));
    }
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
    await cloreSujetProposition(tx, id, par);
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
  const decided = await apply(tx, ctx, current, par);
  await cloreSujetProposition(tx, id, par);
  return decided;
}
