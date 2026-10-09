export type Canal = 'email' | 'appel' | 'tache';
export type Compte = { email: number; appel: number; autre: number; total: number };

// Calendar day (YYYY-MM-DD) of an instant in the given time zone.
export const jourDe = (at: Date, fuseau = 'Europe/Paris') =>
  at.toLocaleDateString('sv-SE', { timeZone: fuseau });

export const decaler = (jour: string, n: number) => {
  const d = new Date(`${jour}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const ouvre = (jour: string) => {
  const w = new Date(`${jour}T12:00:00Z`).getUTCDay();
  return w >= 1 && w <= 5;
};

export function dernierJourOuvre(aujourdhui: string): string {
  let j = decaler(aujourdhui, -1);
  while (!ouvre(j)) j = decaler(j, -1);
  return j;
}

function compter(
  taches: { canal: Canal; faitAt: Date | null }[],
  debut: string,
  fin: string,
  fuseau: string,
): Compte {
  const c = { email: 0, appel: 0, autre: 0, total: 0 };
  for (const t of taches) {
    if (!t.faitAt) continue;
    const j = jourDe(t.faitAt, fuseau);
    if (j < debut || j > fin) continue;
    if (t.canal === 'email') c.email += 1;
    else if (t.canal === 'appel') c.appel += 1;
    else c.autre += 1;
    c.total += 1;
  }
  return c;
}

// Tasks done by channel (mockup brief): the last working day, the last 7 and 30 days with today.
// Days are Paris calendar days: a task done at 23:30 in Paris counts for that day, not the next.
export function compterRealisees(
  taches: { canal: Canal; faitAt: Date | null }[],
  maintenant: Date,
  fuseau = 'Europe/Paris',
) {
  const auj = jourDe(maintenant, fuseau);
  const veille = dernierJourOuvre(auj);
  return {
    veille: { jour: veille, ...compter(taches, veille, veille, fuseau) },
    semaine: compter(taches, decaler(auj, -6), auj, fuseau),
    mois: compter(taches, decaler(auj, -29), auj, fuseau),
    aujourdhui: compter(taches, auj, auj, fuseau),
  };
}

// Where an open task stands today: overdue, due today, or later (Paris calendar days).
export function situation(echeance: Date | null, maintenant: Date, fuseau = 'Europe/Paris') {
  if (!echeance) return 'plus_tard' as const;
  const j = jourDe(echeance, fuseau);
  const auj = jourDe(maintenant, fuseau);
  return j < auj ? ('retard' as const) : j === auj ? ('jour' as const) : ('plus_tard' as const);
}
