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
import { SupportInvalide } from './support.js';

// Début du message du pilote qui lance la capitalisation des règles à partir de la version finale.
export const DEBUT_MESSAGE_REGLES = 'Capitaliser le rapport final';
// Début du message qui demande d'annuler une règle ; l'identifiant de l'entrée du journal le suit.
export const DEBUT_MESSAGE_ANNULATION = 'Annuler la règle';

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

export async function lireEntreeJournal(
  db: Executor,
  instance: Instance,
  id: string,
): Promise<EntreeJournalRegle | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return (await listerJournalRegles(db, instance, 500)).find((e) => e.id === id) ?? null;
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

const LIBELLE_MAX = 200;
const CHANGEMENTS_MAX = 20;

// Claude déclare ce qu'il a changé dans les fiches de règles (ou le résultat d'une annulation) : l'OS
// le garde au journal. Seule une demande de règles en cours ouvre l'écriture, et un libellé ne cite
// jamais l'entreprise du projet : c'est une consigne de style, pas un extrait de rapport.
export async function enregistrerReglesRapport(
  tx: Tx,
  projetId: string,
  charge: {
    changements?: ChangementRegle[];
    annulation?: { journalId: string; effectuee: boolean; motif?: string };
  },
): Promise<void> {
  const [projet] = await tx
    .select()
    .from(diagnosticProjets)
    .where(eq(diagnosticProjets.id, projetId));
  if (!projet) throw new ProjetIntrouvable('Projet introuvable dans cette instance');
  if (charge.annulation) {
    if (projet.demande !== 'regles_annuler')
      throw new SupportInvalide("Le pilote n'a pas demandé d'annulation de règle.");
    const { journalId, effectuee, motif } = charge.annulation;
    await marquerReglesAnnulee(
      tx,
      journalId,
      effectuee ? null : (motif ?? 'Annulation impossible.'),
    );
  }
  const changements = charge.changements ?? [];
  if (changements.length === 0) return;
  if (projet.demande !== 'regles_rapport' && projet.demande !== 'regles_support')
    throw new SupportInvalide("Le pilote n'a pas demandé de capitalisation des règles.");
  if (changements.length > CHANGEMENTS_MAX)
    throw new SupportInvalide(`Trop de changements d'un coup (${CHANGEMENTS_MAX} au plus).`);
  const nom = projet.nom.trim().toLowerCase();
  for (const c of changements) {
    if (c.libelle.length > LIBELLE_MAX)
      throw new SupportInvalide(`Libellé trop long (${LIBELLE_MAX} caractères au plus).`);
    if (nom && c.libelle.toLowerCase().includes(nom))
      throw new SupportInvalide("Un libellé de règle ne cite jamais l'entreprise du projet.");
  }
  const finale = projet.rapportLiens.find((l) => l.finale);
  await ajouterChangementsRegles(
    tx,
    projetId,
    projet.demande === 'regles_support'
      ? 'support final'
      : finale?.version
        ? `version finale ${finale.version}`
        : 'version finale',
    changements,
  );
}
