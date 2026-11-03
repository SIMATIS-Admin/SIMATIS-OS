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
