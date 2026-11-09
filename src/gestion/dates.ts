// Calculs de dates en jours ISO (AAAA-MM-JJ), sans fuseau : partagés par la trésorerie et le pipe.
export const ajouterJours = (jourIso: string, n: number) => {
  const d = new Date(`${jourIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function ajouterMois(jourIso: string, n: number): string {
  const [a, m, j] = jourIso.split('-').map(Number) as [number, number, number];
  const i = a * 12 + (m - 1) + n;
  const annee = Math.floor(i / 12);
  const mois = (i % 12) + 1;
  const dernier = new Date(Date.UTC(annee, mois, 0)).getUTCDate();
  return `${String(annee).padStart(4, '0')}-${String(mois).padStart(2, '0')}-${String(Math.min(j, dernier)).padStart(2, '0')}`;
}

// Cadence unique pour l'instant : une facture par mandat, en fin de mois (dernier jour du mois de `jour`).
export function dateEmissionPrevue(jour: string): string {
  const [a, m] = jour.split('-').map(Number) as [number, number];
  const dernier = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${jour.slice(0, 7)}-${String(dernier).padStart(2, '0')}`;
}
