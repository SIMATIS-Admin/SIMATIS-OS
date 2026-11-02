// Aides d'affichage de la section Gestion. Montants en centimes entiers, jamais en flottants stockés.
export const eurCents = (cents: number) =>
  `${(cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })} €`;

// « 12,5 » ou « 1 234.50 » → centimes ; null si ce n'est pas un montant positif.
export function versCents(saisie: string): number | null {
  const n = Number(saisie.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

export const MOIS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

export const libelleMois = (mois: string) => {
  const [a, m] = mois.split('-').map(Number) as [number, number];
  return `${MOIS[m - 1]} ${a}`;
};

export function moisDecale(mois: string, n: number): string {
  const [a, m] = mois.split('-').map(Number) as [number, number];
  const i = a * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

export const MOIS_COURTS = [
  'janv.',
  'févr.',
  'mars',
  'avr.',
  'mai',
  'juin',
  'juil.',
  'août',
  'sept.',
  'oct.',
  'nov.',
  'déc.',
];

export const jourCourt = (jour: string) => {
  const [, m, j] = jour.split('-').map(Number) as [number, number, number];
  return `${j} ${MOIS_COURTS[m - 1]}`;
};

export const aujourdhui = (maintenant = new Date()) =>
  new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(maintenant);

export const PAS_MOIS = { aucune: 0, mensuelle: 1, trimestrielle: 3, annuelle: 12 } as const;
export type Cadence = keyof typeof PAS_MOIS;

// Effet d'une dépense sur 12 mois consécutifs : par mois en moyenne et au total.
export function effet12(cents: number, cadence: Cadence) {
  const pas = PAS_MOIS[cadence];
  if (!pas) return { parMois: 0, total12: cents };
  return { parMois: Math.round(cents / pas), total12: Math.round((cents * 12) / pas) };
}
