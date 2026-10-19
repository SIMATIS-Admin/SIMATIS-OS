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

// A timed event longer than two hours is a slot booked to get organised (a room, a block of
// time for a mandate), not a meeting: it never counts nor shows as a rendez-vous.
export const DUREE_MAX_RDV_MS = 2 * 60 * 60_000;
export const estCreneau = (r: { debut: Date; fin: Date; journee: boolean }) =>
  !r.journee && r.fin.getTime() - r.debut.getTime() > DUREE_MAX_RDV_MS;

// Meetings held (Brief activity): over, with a time and at least one guest, so that all-day
// events and personal blocks ("focus", lunch) do not count. Day of the start, in Paris.
export function compterRdvTenus(
  rdv: { debut: Date; fin: Date; journee: boolean; participants: string[] }[],
  maintenant: Date,
  fuseau = 'Europe/Paris',
) {
  const auj = jourDe(maintenant, fuseau);
  const veille = dernierJourOuvre(auj);
  const jours = rdv
    .filter((r) => !r.journee && !estCreneau(r) && r.participants.length > 0 && r.fin <= maintenant)
    .map((r) => jourDe(r.debut, fuseau));
  const entre = (debut: string, fin: string) => jours.filter((j) => j >= debut && j <= fin).length;
  return {
    veille: entre(veille, veille),
    semaine: entre(decaler(auj, -6), auj),
    mois: entre(decaler(auj, -29), auj),
  };
}

// Meetings still to come or under way today, slots left out. An all-day event carries plain dates (end
// exclusive) read as UTC midnight: compare those dates, not instants, or yesterday's all-day
// event would end at 02:00 today in Paris and show up.
export function rdvDuJour<T extends { debut: Date; fin: Date; journee: boolean }>(
  rdv: T[],
  maintenant: Date,
  fuseau = 'Europe/Paris',
): T[] {
  const auj = jourDe(maintenant, fuseau);
  return rdv.filter(
    (r) =>
      !estCreneau(r) &&
      (r.journee ? r.fin.toISOString().slice(0, 10) > auj : jourDe(r.fin, fuseau) >= auj),
  );
}

// Where an open task stands today: overdue, due today, or later (Paris calendar days).
export function situation(echeance: Date | null, maintenant: Date, fuseau = 'Europe/Paris') {
  if (!echeance) return 'plus_tard' as const;
  const j = jourDe(echeance, fuseau);
  const auj = jourDe(maintenant, fuseau);
  return j < auj ? ('retard' as const) : j === auj ? ('jour' as const) : ('plus_tard' as const);
}
