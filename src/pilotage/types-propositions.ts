import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { connexions } from '../connexions/schema.js';
import { writeVia } from '../connexions/service.js';
import { taches } from '../crm/schema.js';
import { currentInstance } from '../db/columns.js';
import { registerPropositionType } from '../propositions/registry.js';

const uuid = z.uuid().nullish();

// Email draft prepared by the OS or an agent: once validated, it becomes a Gmail draft of the
// instance (never sent). Attached to a task, the task shows "Brouillon prêt dans Gmail".
export const emailBrouillon = z.object({
  to: z.email(),
  objet: z.string().trim().min(1).max(300),
  corps: z.string().min(1).max(50_000),
  contactId: uuid,
  tacheId: uuid,
  origine: z.string().max(200).nullish(),
  controles: z.array(z.string().max(500)).max(20).nullish(),
});

registerPropositionType({
  type: 'email.brouillon',
  action: 'brouillon',
  schema: emailBrouillon,
  apply: async (tx, c, ctx) => {
    const result = await writeVia(
      tx,
      ctx.instance,
      'messagerie',
      { op: 'draft.create', data: { to: c.to, subject: c.objet, html: c.corps } },
      ctx.deps,
    );
    if (c.tacheId && !result.simulation) {
      await tx
        .update(taches)
        .set({ prepare: true, updatedAt: new Date() })
        .where(and(eq(taches.instanceId, currentInstance), eq(taches.id, c.tacheId)));
    }
    return result;
  },
});

// Follow-up task: in the instance's CRM when it has one (then its copy), otherwise in the OS.
export const crmTache = z.object({
  titre: z.string().trim().min(1).max(300),
  detail: z.string().max(5_000).nullish(),
  canal: z.enum(['email', 'appel', 'tache']).default('tache'),
  echeance: z.iso.datetime({ offset: true }).nullish(),
  contactId: uuid,
  opportuniteId: uuid,
  origine: z.string().max(200).nullish(),
});

registerPropositionType({
  type: 'crm.tache',
  action: 'tache',
  schema: crmTache,
  apply: async (tx, c, ctx) => {
    const [crm] = await tx
      .select({ fournisseur: connexions.fournisseur })
      .from(connexions)
      .where(and(eq(connexions.instanceId, currentInstance), eq(connexions.kind, 'crm')));
    const values = {
      titre: c.titre,
      canal: c.canal,
      echeance: c.echeance ? new Date(c.echeance) : null,
      contactId: c.contactId ?? null,
      opportuniteId: c.opportuniteId ?? null,
    };
    if (crm?.fournisseur === 'hubspot') {
      const result = await writeVia(
        tx,
        ctx.instance,
        'crm',
        { op: 'task.create', data: { ...values, detail: c.detail, echeance: c.echeance } },
        ctx.deps,
      );
      if (result.simulation) return result;
      await tx.insert(taches).values({
        instanceId: currentInstance,
        source: 'hubspot',
        sourceId: typeof result.id === 'string' ? result.id : null,
        ...values,
      });
      return result;
    }
    const [row] = await tx
      .insert(taches)
      .values({ instanceId: currentInstance, ...values })
      .returning({ id: taches.id });
    return { simulation: false, id: row?.id };
  },
});

// Note for the second brain: always a draft that the pilot rereads there, never validated by the OS.
export const noteSecondCerveau = z.object({
  titre: z.string().trim().min(1).max(300),
  texte: z.string().min(1).max(20_000),
  destination: z.string().max(300).nullish(),
  origine: z.string().max(200).nullish(),
});

registerPropositionType({
  type: 'note.second_cerveau',
  action: 'cerveau',
  schema: noteSecondCerveau,
  // Export to the second brain's inbox comes with the second-brain lot; until then it stays here.
  apply: () => Promise.resolve({ brouillon: true }),
});
