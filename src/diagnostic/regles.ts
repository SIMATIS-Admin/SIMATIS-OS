import { desc, eq } from 'drizzle-orm';
import type { Executor, Tx } from '../db.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import {
  diagnosticProjets,
  diagnosticReglesJournal,
  type ActionRegle,
  type FicheRegles,
} from './schema.js';
import { ProjetIntrouvable } from './service.js';

// Un changement que Claude a fait dans une fiche de règles, déclaré à l'OS pour le journal.
export type ChangementRegle = {
  fiche: FicheRegles;
  action: Exclude<ActionRegle, 'annulée'>;
  libelle: string;
  avant: string | null;
  apres: string | null;
};

export type EntreeJournalRegle = {
  id: string;
  le: string;
  projetId: string;
  fiche: FicheRegles;
  action: ActionRegle;
  libelle: string;
  avant: string | null;
  apres: string | null;
  origine: string;
  statut: 'actif' | 'annule';
  motifRefus: string | null;
};

export async function ajouterChangementsRegles(
  tx: Tx,
  projetId: string,
  origine: string,
  changements: ChangementRegle[],
): Promise<void> {
  if (changements.length === 0) return;
  const [projet] = await tx
    .select({ instanceId: diagnosticProjets.instanceId })
    .from(diagnosticProjets)
    .where(eq(diagnosticProjets.id, projetId));
  if (!projet) throw new ProjetIntrouvable('Projet introuvable dans cette instance');
  await tx
    .insert(diagnosticReglesJournal)
    .values(changements.map((c) => ({ ...c, projetId, origine, instanceId: projet.instanceId })));
}

export function listerJournalRegles(
  db: Executor,
  instance: Instance,
  limite = 50,
): Promise<EntreeJournalRegle[]> {
  return withInstance(db, instance.id, async (tx) => {
    const lignes = await tx
      .select()
      .from(diagnosticReglesJournal)
      .where(eq(diagnosticReglesJournal.instanceId, instance.id))
      .orderBy(desc(diagnosticReglesJournal.createdAt))
      .limit(limite);
    return lignes.map((l) => ({
      id: l.id,
      le: l.createdAt.toISOString(),
      projetId: l.projetId,
      fiche: l.fiche,
      action: l.action,
      libelle: l.libelle,
      avant: l.avant,
      apres: l.apres,
      origine: l.origine,
      statut: l.statut,
      motifRefus: l.motifRefus,
    }));
  });
}

// Fin d'une demande d'annulation. Avec un motif, l'annulation n'a pas pu se faire (la fiche a changé
// depuis) : l'entrée reste active et le motif s'affiche. Sans motif, l'entrée passe à « annulée » et
// une nouvelle entrée « annulée » garde la trace.
export async function marquerReglesAnnulee(
  tx: Tx,
  id: string,
  motif: string | null,
): Promise<void> {
  const [entree] = await tx
    .select()
    .from(diagnosticReglesJournal)
    .where(eq(diagnosticReglesJournal.id, id));
  if (!entree) throw new ProjetIntrouvable('Entrée de journal introuvable dans cette instance');
  if (motif) {
    await tx
      .update(diagnosticReglesJournal)
      .set({ motifRefus: motif, updatedAt: new Date() })
      .where(eq(diagnosticReglesJournal.id, id));
    return;
  }
  await tx
    .update(diagnosticReglesJournal)
    .set({ statut: 'annule', motifRefus: null, updatedAt: new Date() })
    .where(eq(diagnosticReglesJournal.id, id));
  await tx.insert(diagnosticReglesJournal).values({
    instanceId: entree.instanceId,
    projetId: entree.projetId,
    fiche: entree.fiche,
    action: 'annulée',
    libelle: entree.libelle,
    avant: entree.apres,
    apres: entree.avant,
    origine: `annulation de l'entrée du ${entree.createdAt.toISOString().slice(0, 10)}`,
    statut: 'annule',
  });
}
