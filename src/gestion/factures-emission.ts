import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { SLUG } from '../instances/service.js';
import { facturesParMandat } from './factures.js';
import { lireRevenu, modifierOccurrenceRevenu, modifierRevenu } from './revenus.js';
import { gestionFactures, gestionIkTrajets, type LigneFigee } from './schema.js';

export class FactureInvalide extends Error {}
export class FactureIntrouvable extends Error {
  constructor() {
    super('Facture introuvable');
  }
}

const jour = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const emettreSchema = z.object({
  mandat: z.string().regex(SLUG),
  numero: z.string().trim().min(1).max(100),
  dateEmission: jour,
  // Clés des lignes décochées : elles restent à émettre.
  exclure: z.array(z.string()).max(500).default([]),
});
export const encaisserSchema = z.object({ dateEncaissement: jour });

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

const vue = (l: typeof gestionFactures.$inferSelect): FactureEmise => ({
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
  return lignes.map(vue);
}

// Fait suivre aux recettes d'une facture son état (émise, puis encaissée). Les lignes IK n'ont pas
// d'état propre : leur trajet porte `factureId`.
async function propagerAuxRecettes(
  tx: Executor,
  instanceId: string,
  lignes: LigneFigee[],
  numero: string,
  etat: 'emise' | 'encaissee',
  dateEncaissement: string | null,
) {
  for (const l of lignes) {
    if (!l.cle.startsWith('revenu:')) continue;
    const [id, date] = l.cle.slice('revenu:'.length).split('|') as [string, string];
    const serie = await lireRevenu(tx, id);
    if (serie.recurrence === 'aucune')
      await modifierRevenu(
        tx,
        id,
        etat === 'emise'
          ? { etat, referenceFacture: numero }
          : { etat, dateEncaissement, referenceFacture: numero },
      );
    else
      await modifierOccurrenceRevenu(tx, instanceId, id, date, {
        portee: 'cette',
        etat,
        dateEncaissement,
        referenceFacture: numero,
      });
  }
}

export async function emettreFacture(
  tx: Executor,
  instanceId: string,
  e: z.infer<typeof emettreSchema>,
): Promise<FactureEmise> {
  const numero = e.numero.trim();
  if (!numero) throw new FactureInvalide('Le numéro de la facture est obligatoire.');
  const [pris] = await tx
    .select({ id: gestionFactures.id })
    .from(gestionFactures)
    .where(
      and(eq(gestionFactures.instanceId, currentInstance), eq(gestionFactures.numero, numero)),
    );
  if (pris) throw new FactureInvalide(`Le numéro ${numero} est déjà utilisé.`);

  const calcul = await facturesParMandat(tx, e.dateEmission, e.dateEmission);
  const facture = calcul.factures.find((f) => f.mandat === e.mandat);
  const lignes: LigneFigee[] = (facture?.lignes ?? [])
    .filter((l) => !e.exclure.includes(l.cle) && l.montantHtCents != null)
    .map((l) => ({
      cle: l.cle,
      sorte: l.sorte,
      libelle: l.libelle,
      date: l.date,
      montantHtCents: l.montantHtCents!,
      tvaCents: l.tvaCents,
    }));
  if (!lignes.length) throw new FactureInvalide('Rien à facturer pour ce mandat.');

  const [cree] = await tx
    .insert(gestionFactures)
    .values({
      instanceId,
      mandat: e.mandat,
      numero,
      dateEmission: e.dateEmission,
      totalHtCents: lignes.reduce((s, l) => s + l.montantHtCents, 0),
      delaiJours: facture!.delaiJours,
      lignes,
    })
    .returning();
  await propagerAuxRecettes(tx, instanceId, lignes, numero, 'emise', null);
  for (const l of lignes.filter((x) => x.cle.startsWith('ik:')))
    await tx
      .update(gestionIkTrajets)
      .set({ factureId: cree!.id, updatedAt: new Date() })
      .where(eq(gestionIkTrajets.id, l.cle.slice('ik:'.length)));
  return vue(cree!);
}

export async function encaisserFacture(
  tx: Executor,
  instanceId: string,
  id: string,
  dateEncaissement: string,
): Promise<FactureEmise> {
  const [f] = await tx
    .select()
    .from(gestionFactures)
    .where(and(eq(gestionFactures.instanceId, currentInstance), eq(gestionFactures.id, id)));
  if (!f) throw new FactureIntrouvable();
  if (f.etat === 'encaissee') throw new FactureInvalide('Cette facture est déjà encaissée.');
  if (dateEncaissement < f.dateEmission)
    throw new FactureInvalide("L'encaissement ne peut pas précéder l'émission.");
  await propagerAuxRecettes(tx, instanceId, f.lignes, f.numero, 'encaissee', dateEncaissement);
  const [maj] = await tx
    .update(gestionFactures)
    .set({ etat: 'encaissee', dateEncaissement, updatedAt: new Date() })
    .where(eq(gestionFactures.id, id))
    .returning();
  return vue(maj!);
}
