import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { occurrencesRevenus } from './revenus.js';
import { gestionTvaMois } from './schema.js';
import { occurrencesDepenses } from './service.js';

export const tvaSaisieSchema = z.object({
  declareeCents: z.number().int().nullable(),
  note: z.string().trim().max(500).nullable().optional(),
});

export type SuiviTva = {
  mois: string;
  // Déclaration mensuelle : confirmé. Exigibilité (facturation ou encaissement) : à confirmer avec le
  // comptable ; l'estimation retient la date de facture et reste donc incertaine.
  declaration: 'mensuelle';
  exigibilite: 'a_confirmer';
  collecteeCents: number;
  deductibleCents: number;
  // Positif = à payer, négatif = crédit. Jamais présenté comme une dette fiscale certaine.
  estimeeCents: number;
  lignesSansTva: { recettes: number; depenses: number };
  recettesIncertainesExclues: number;
  declaree: { montantCents: number | null; note: string | null } | null;
  avertissements: string[];
};

const finDeMois = (mois: string) => {
  const [a, m] = mois.split('-').map(Number) as [number, number];
  return `${mois}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

export async function suiviTva(tx: Executor, mois: string): Promise<SuiviTva> {
  const de = `${mois}-01`;
  const a = finDeMois(mois);
  const recettes = (await occurrencesRevenus(tx, de, a)).filter(
    (o) => o.etat !== 'ignoree' && o.date.startsWith(mois),
  );
  const depenses = (await occurrencesDepenses(tx, de, a)).filter(
    (o) => o.etat !== 'ignoree' && o.payeur === 'societe' && o.cle.split('|')[1]!.startsWith(mois),
  );
  const certaines = recettes.filter((o) => o.certitude === 'certaine');
  const somme = (l: (number | null)[]) => l.reduce<number>((t, v) => t + (v ?? 0), 0);
  const collectee = somme(certaines.map((o) => o.tvaCents));
  const deductible = somme(depenses.map((o) => o.tvaCents));
  const sansTva = {
    recettes: certaines.filter((o) => o.tvaCents == null).length,
    depenses: depenses.filter((o) => o.tvaCents == null).length,
  };
  const [saisie] = await tx
    .select()
    .from(gestionTvaMois)
    .where(and(eq(gestionTvaMois.instanceId, currentInstance), eq(gestionTvaMois.mois, mois)));
  const avertissements = [
    "Exigibilité à confirmer avec le comptable : l'estimation retient la date de facture.",
    ...(sansTva.recettes + sansTva.depenses
      ? [
          `${sansTva.recettes + sansTva.depenses} ligne(s) sans TVA renseignée : elles ne sont pas dans l'estimation.`,
        ]
      : []),
  ];
  return {
    mois,
    declaration: 'mensuelle',
    exigibilite: 'a_confirmer',
    collecteeCents: collectee,
    deductibleCents: deductible,
    estimeeCents: collectee - deductible,
    lignesSansTva: sansTva,
    recettesIncertainesExclues: recettes.length - certaines.length,
    declaree: saisie ? { montantCents: saisie.declareeCents, note: saisie.note } : null,
    avertissements,
  };
}

// Montant réellement déclaré, saisi à la main ; il n'est jamais transmis nulle part.
export async function saisirTva(
  tx: Executor,
  instanceId: string,
  mois: string,
  s: z.infer<typeof tvaSaisieSchema>,
) {
  const valeurs = { declareeCents: s.declareeCents, note: s.note ?? null };
  await tx
    .insert(gestionTvaMois)
    .values({ instanceId, mois, ...valeurs })
    .onConflictDoUpdate({
      target: [gestionTvaMois.instanceId, gestionTvaMois.mois],
      set: { ...valeurs, updatedAt: new Date() },
    });
  return suiviTva(tx, mois);
}
