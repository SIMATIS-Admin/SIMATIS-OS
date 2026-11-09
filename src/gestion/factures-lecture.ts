import { desc, eq } from 'drizzle-orm';
import type { Executor } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { gestionFactures, type LigneFigee } from './schema.js';

// Lecture seule des factures émises, sans dépendance au calcul : la trésorerie la partage avec
// l'émission sans créer de cycle d'import.
export type FactureEmise = {
  id: string;
  mandat: string;
  numero: string;
  dateEmission: string;
  delaiJours: number | null;
  totalHtCents: number;
  etat: 'emise' | 'encaissee';
  dateEncaissement: string | null;
  lignes: LigneFigee[];
};

export const vueFacture = (l: typeof gestionFactures.$inferSelect): FactureEmise => ({
  id: l.id,
  mandat: l.mandat,
  numero: l.numero,
  dateEmission: l.dateEmission,
  delaiJours: l.delaiJours,
  totalHtCents: l.totalHtCents,
  etat: l.etat,
  dateEncaissement: l.dateEncaissement,
  lignes: l.lignes,
});

export async function lireFacturesEmises(tx: Executor): Promise<FactureEmise[]> {
  const lignes = await tx
    .select()
    .from(gestionFactures)
    .where(eq(gestionFactures.instanceId, currentInstance))
    .orderBy(desc(gestionFactures.dateEmission), desc(gestionFactures.createdAt));
  return lignes.map(vueFacture);
}
