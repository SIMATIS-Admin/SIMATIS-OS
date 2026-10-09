// Shared by the Tâches screen and its week view.
export const TYPES = {
  email: ['send', 'Email'],
  appel: ['phone', 'Téléphone'],
  tache: ['check', 'Action'],
} as const;

export const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const lundiDe = (d: Date) => {
  const l = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  l.setDate(l.getDate() - ((l.getDay() + 6) % 7));
  return iso(l);
};
export const plusJours = (jour: string, n: number) => {
  const [y, m, d] = jour.split('-').map(Number) as [number, number, number];
  return iso(new Date(y, m - 1, d + n));
};
