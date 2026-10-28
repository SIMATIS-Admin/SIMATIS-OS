import type { Objectifs } from './etat.js';

const num = (v: unknown, d: number) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) && n > 0 ? n : d;
};

export type Entonnoir = {
  ca: number;
  panier: number;
  part: number;
  caRecurrent: number;
  caPonctuel: number;
  abo: number;
  ventes: number;
  abonnes: number;
  rdv: number;
  contacts: number;
  mrr: number;
  commission: number;
  commissionRecurrente: number;
};

// Du chiffre d'affaires visé au nombre de contacts : la part en abonnement donne des abonnés
// (facturés `mois` mois sur l'année), le reste des ventes au panier moyen. Toute entrée vide ou
// négative est remplacée par une valeur sûre : pas de division par zéro.
export function entonnoir(o: Objectifs): Entonnoir {
  const ca = num(o.ca, 1);
  const panier = num(o.panier, 1);
  const t1 = Math.min(100, num(o.tx1, 1));
  const t2 = Math.min(100, num(o.tx2, 1));
  const part = Math.min(100, Math.max(0, parseFloat(String(o.part)) || 0));
  const abo = num(o.abo, 1);
  const mois = Math.min(12, num(o.mois, 1));
  const taux = num(o.taux, 10) / 100;
  const caRecurrent = (ca * part) / 100;
  const caPonctuel = ca - caRecurrent;
  const ventes = caPonctuel > 0 ? Math.ceil(caPonctuel / panier) : 0;
  const abonnes = caRecurrent > 0 ? Math.ceil(caRecurrent / (abo * mois)) : 0;
  const rdv = Math.ceil((ventes + abonnes) / (t1 / 100));
  const contacts = Math.ceil(rdv / (t2 / 100));
  const mrr = abonnes * abo;
  return {
    ca,
    panier,
    part,
    caRecurrent,
    caPonctuel,
    abo,
    ventes,
    abonnes,
    rdv,
    contacts,
    mrr,
    commission: ca * taux,
    commissionRecurrente: mrr * 12 * taux,
  };
}

// Dernier jour du mois, trois mois par trimestre à partir de la date de l'atelier (AAAA-MM-JJ).
export function echeanceTrimestre(date: string, q: number): string {
  const [a, m] = date.split('-').map(Number);
  const fin = new Date(Date.UTC(a!, m! - 1 + 3 * (q + 1) + 1, 0));
  return fin.toISOString().slice(0, 10);
}
