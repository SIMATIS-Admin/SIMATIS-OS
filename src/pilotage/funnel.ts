import { z } from 'zod';

// Bounds of the dashboard sliders (mockup VIEWS.tableau).
export const funnelSchema = z.object({
  leads: z.number().int().min(5).max(200),
  l2p: z.number().int().min(5).max(80),
  p2d: z.number().int().min(5).max(100),
  d2c: z.number().int().min(5).max(90),
  panier: z.number().int().min(2000).max(60000),
  objectif: z.number().int().min(0).max(100_000_000),
});

export type Funnel = z.infer<typeof funnelSchema>;

export const FUNNEL_DEFAUT: Funnel = {
  leads: 30,
  l2p: 30,
  p2d: 50,
  d2c: 35,
  panier: 15000,
  objectif: 200000,
};

// Monthly lead → meeting → quote → order chain, and the leads needed to reach the yearly target
// at constant rates.
export function simulerFunnel(f: Funnel) {
  const prospects = (f.leads * f.l2p) / 100;
  const devis = (prospects * f.p2d) / 100;
  const commandes = (devis * f.d2c) / 100;
  const caAnnuel = commandes * f.panier * 12;
  const parLead = (f.l2p / 100) * (f.p2d / 100) * (f.d2c / 100) * f.panier;
  return {
    prospects,
    devis,
    commandes,
    caAnnuel,
    leadsNecessaires: Math.ceil(f.objectif / 12 / parLead),
    objectifTenu: caAnnuel >= f.objectif,
  };
}
