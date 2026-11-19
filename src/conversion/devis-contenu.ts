import { z } from 'zod';

const texte = (max: number) => z.string().max(max);

export const ligneSchema = z.object({
  libelle: z.string().trim().min(1).max(300),
  // Lines saved before units existed carry none: they read as a flat fee.
  unite: z.enum(['forfait', 'jour', 'mois', 'personne', 'heure']).default('forfait'),
  quantite: z.number().int().min(1).max(10_000),
  prixUnitaire: z.number().int().min(0).max(10_000_000).nullable(),
  prixPropose: z.number().int().min(0).max(10_000_000).nullable().optional(),
});

export const clauseSchema = z.object({
  titre: z.string().trim().min(1).max(200),
  texte: texte(4000),
  active: z.boolean(),
});

export const contenuSchema = z.object({
  titre: z.string().trim().min(1).max(300),
  contexte: texte(4000),
  objectifs: texte(4000),
  inclus: texte(4000),
  exclu: texte(4000),
  livrables: texte(4000),
  debut: z.iso.date().nullable(),
  duree: z.string().max(100),
  lignes: z.array(ligneSchema).min(1).max(50),
  remisePct: z.number().int().min(0).max(100),
  acomptePct: z.number().int().min(0).max(100),
  frais: z.enum(['refactures', 'inclus']),
  validiteJours: z.number().int().min(1).max(365),
  clauses: z.array(clauseSchema).max(40),
});

export type ContenuDevis = z.infer<typeof contenuSchema>;

const centimes = (x: number) => Math.round(x * 100) / 100;

type Montants = Pick<ContenuDevis, 'lignes' | 'remisePct' | 'acomptePct'>;

// Same arithmetic as web/src/devis.ts: both sides pin the same cases in their tests.
export function calculer(c: Montants, tvaPct = 20) {
  const brut = c.lignes.reduce((a, l) => a + (l.prixUnitaire ?? 0) * l.quantite, 0);
  const remise = centimes((brut * c.remisePct) / 100);
  const ht = centimes(brut - remise);
  const tva = centimes((ht * tvaPct) / 100);
  const ttc = centimes(ht + tva);
  return {
    brut,
    remise,
    ht,
    tva,
    ttc,
    acompte: centimes((ttc * c.acomptePct) / 100),
    prixManquant: c.lignes.some((l) => l.prixUnitaire === null),
  };
}
