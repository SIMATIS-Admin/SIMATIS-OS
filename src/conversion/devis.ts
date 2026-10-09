import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { entreprises, opportunites } from '../crm/schema.js';
import type { Executor, Tx } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { logEvent } from '../journal/service.js';
import { registerPropositionType } from '../propositions/registry.js';
import { propose, type PropositionCtx } from '../propositions/service.js';
import { devis, type Devis, type LigneDevis } from './schema.js';

export class DevisRefuse extends Error {}

// Quotes are SIMATIS's own offer: only the "propre" instance with the devis module has them.
export const devisActif = (instance: Instance) =>
  instance.type === 'propre' && (instance.config.modules ?? []).includes('devis');

export const total = (lignes: LigneDevis[]) =>
  lignes.reduce((a, l) => a + (l.prixUnitaire ?? 0) * l.quantite, 0);
const prixManquant = (lignes: LigneDevis[]) => lignes.some((l) => l.prixUnitaire === null);

export const lignesSchema = z
  .array(
    z.object({
      libelle: z.string().trim().min(1).max(300),
      quantite: z.number().int().min(1).max(10_000),
      prixUnitaire: z.number().int().min(0).max(10_000_000).nullable(),
    }),
  )
  .min(1)
  .max(50);

async function charger(tx: Tx, id: string): Promise<Devis> {
  const [row] = await tx
    .select()
    .from(devis)
    .where(and(eq(devis.instanceId, currentInstance), eq(devis.id, id)));
  if (!row) throw new DevisRefuse('Devis introuvable');
  return row;
}

export async function listerDevis(db: Executor, instance: Instance) {
  return withInstance(db, instance.id, async (tx) => {
    const rows = await tx
      .select({
        devis,
        opportunite: opportunites.titre,
        entreprise: entreprises.nom,
      })
      .from(devis)
      .innerJoin(
        opportunites,
        and(eq(opportunites.id, devis.opportuniteId), eq(opportunites.instanceId, currentInstance)),
      )
      .leftJoin(
        entreprises,
        and(
          eq(entreprises.id, opportunites.entrepriseId),
          eq(entreprises.instanceId, currentInstance),
        ),
      )
      .where(eq(devis.instanceId, currentInstance))
      .orderBy(desc(devis.createdAt));
    return rows.map((r) => ({
      ...r.devis,
      opportunite: r.opportunite,
      entreprise: r.entreprise,
      total: total(r.devis.lignes),
      prixManquant: prixManquant(r.devis.lignes),
    }));
  });
}

// The OS prepares the lines from the deal; every price is left for the pilot to set.
export async function preparerDevis(db: Executor, instance: Instance, opportuniteId: string) {
  return withInstance(db, instance.id, async (tx) => {
    const [opp] = await tx
      .select({ titre: opportunites.titre })
      .from(opportunites)
      .where(and(eq(opportunites.instanceId, currentInstance), eq(opportunites.id, opportuniteId)));
    if (!opp) throw new DevisRefuse('Opportunité introuvable dans cette instance');
    const existants = await tx
      .select({ id: devis.id })
      .from(devis)
      .where(eq(devis.instanceId, currentInstance));
    const annee = new Date().getFullYear();
    const prefixe = instance.type === 'prospect' ? 'DEMO' : `DEV-${annee}`;
    const numero = `${prefixe}-${String(existants.length + 1).padStart(3, '0')}`;
    const [row] = await tx
      .insert(devis)
      .values({
        instanceId: currentInstance,
        opportuniteId,
        numero,
        lignes: [
          { libelle: opp.titre, quantite: 1, prixUnitaire: null },
          { libelle: 'Restitution et plan de suivi', quantite: 1, prixUnitaire: null },
        ],
      })
      .returning();
    await logEvent(tx, {
      acteur: 'os',
      action: `Devis préparé : ${numero} (prix à fixer)`,
      niveau: 'L1',
    });
    if (!row) throw new Error('Devis non créé');
    return row;
  });
}

export async function modifierLignes(
  db: Executor,
  instance: Instance,
  id: string,
  lignes: LigneDevis[],
) {
  return withInstance(db, instance.id, async (tx) => {
    const current = await charger(tx, id);
    if (current.statut !== 'brouillon') throw new DevisRefuse('Devis déjà validé : non modifiable');
    const [row] = await tx
      .update(devis)
      .set({ lignes, updatedAt: new Date() })
      .where(eq(devis.id, id))
      .returning();
    return row ?? current;
  });
}

export async function validerDevis(db: Executor, instance: Instance, id: string) {
  return withInstance(db, instance.id, async (tx) => {
    const current = await charger(tx, id);
    if (current.statut !== 'brouillon') throw new DevisRefuse('Devis déjà validé');
    if (prixManquant(current.lignes)) throw new DevisRefuse("Fixez tous les prix d'abord");
    const [row] = await tx
      .update(devis)
      .set({ statut: 'valide', updatedAt: new Date() })
      .where(eq(devis.id, id))
      .returning();
    await logEvent(tx, {
      acteur: 'pilote',
      action: `Devis validé et prix fixés : ${current.numero}`,
      niveau: 'L1',
    });
    return row ?? current;
  });
}

const transmission = z.object({ devisId: z.uuid(), numero: z.string(), montant: z.number() });

// Sending a quote commits SIMATIS to the client: it always waits for the pilot's explicit
// validation (action « transmettre », locked at L2).
registerPropositionType({
  type: 'devis.transmettre',
  action: 'transmettre',
  schema: transmission,
  apply: async (tx, c) => {
    const current = await charger(tx, c.devisId);
    if (current.statut !== 'valide') throw new DevisRefuse('Le devis doit être validé avant envoi');
    const envoye = new Date();
    const validite = new Date(envoye.getTime() + 30 * 864e5).toISOString().slice(0, 10);
    await tx
      .update(devis)
      .set({ statut: 'transmis', envoyeLe: envoye, validite, updatedAt: envoye })
      .where(eq(devis.id, c.devisId));
    // A sent quote moves an open native deal to "proposition" unless it is already further
    // (a mirrored CRM keeps its own stage ids and is left alone).
    await tx
      .update(opportunites)
      .set({ etape: 'proposition', updatedAt: envoye })
      .where(
        and(
          eq(opportunites.instanceId, currentInstance),
          eq(opportunites.id, current.opportuniteId),
          isNull(opportunites.clos),
          inArray(opportunites.etape, ['detection', 'prospection', 'qualification']),
        ),
      );
    return { simulation: false, statut: 'transmis' };
  },
});

export async function demanderTransmission(db: Executor, ctx: PropositionCtx, id: string) {
  return withInstance(db, ctx.instance.id, async (tx) => {
    const current = await charger(tx, id);
    if (current.statut !== 'valide')
      throw new DevisRefuse('Validez le devis avant de le transmettre');
    return propose(tx, ctx, {
      type: 'devis.transmettre',
      contenu: { devisId: id, numero: current.numero, montant: total(current.lignes) },
      auteur: 'os',
    });
  });
}
