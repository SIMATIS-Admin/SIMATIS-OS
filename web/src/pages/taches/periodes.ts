import { plusJours } from './commun.js';
import { jourParis } from './creneaux.js';

export type CleePeriode = 'retard' | 'aujourdhui' | 'demain' | 'semaine' | 'prochaine';

// Monday of a Paris day (YYYY-MM-DD), computed on the calendar date, not the browser clock.
const lundiDu = (jour: string) => {
  const [y, m, d] = jour.split('-').map(Number) as [number, number, number];
  const k = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return plusJours(jour, -k);
};

export function periode(
  cle: CleePeriode,
  maintenant = new Date(),
): { du: string; au: string } | 'retard' {
  const jour = jourParis(maintenant.toISOString());
  switch (cle) {
    case 'retard':
      return 'retard';
    case 'aujourdhui':
      return { du: jour, au: jour };
    case 'demain':
      return { du: plusJours(jour, 1), au: plusJours(jour, 1) };
    case 'semaine':
      return { du: lundiDu(jour), au: plusJours(lundiDu(jour), 6) };
    case 'prochaine':
      return { du: plusJours(lundiDu(jour), 7), au: plusJours(lundiDu(jour), 13) };
  }
}
