export type Intervalle = { debut: Date; fin: Date };

export type CreneauxOptions = {
  nombre: number;
  // Never before this many working days from today.
  delaiJours: number;
  // Paris wall-clock windows, e.g. [['09:30', '12:00'], ['14:00', '17:00']].
  plages: [string, string][];
  // Free margin kept around existing meetings.
  tamponMin: number;
  jours: 'ouvres' | 'lun-jeu' | 'tous';
  fuseau: 'Europe/Paris';
  dureeMin?: number;
};

const PAS_MIN = 30;

// Offset (ms) between the wall clock of `timeZone` and UTC at a given instant.
function offsetMs(timeZone: string, at: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - at.getTime();
}

// Instant of a wall-clock time (YYYY-MM-DD, HH:MM) in the given time zone.
export function zoned(day: string, hhmm: string, timeZone: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0);
  const first = guess - offsetMs(timeZone, new Date(guess));
  // Second pass for the days when the offset changes (summer / winter time).
  return new Date(guess - offsetMs(timeZone, new Date(first)));
}

const dayOf = (at: Date, timeZone: string) => at.toLocaleDateString('sv-SE', { timeZone });
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();

function eligible(day: string, jours: CreneauxOptions['jours']): boolean {
  const w = weekday(day);
  if (jours === 'tous') return true;
  if (jours === 'lun-jeu') return w >= 1 && w <= 4;
  return w >= 1 && w <= 5;
}

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
const hhmm = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

// Free slots to offer a contact (mockup rule): varied times, each on a different day, within the
// windows, never before today + delaiJours working days, away from meetings and their margin.
export function creneauxLibres(
  occupe: Intervalle[],
  options: CreneauxOptions,
  maintenant: Date,
): Date[] {
  const duree = options.dureeMin ?? 60;
  const tampon = options.tamponMin * 60_000;
  const libre = (debut: Date) => {
    const fin = new Date(debut.getTime() + duree * 60_000);
    return occupe.every(
      (o) =>
        fin.getTime() <= o.debut.getTime() - tampon || debut.getTime() >= o.fin.getTime() + tampon,
    );
  };

  let day = dayOf(maintenant, options.fuseau);
  for (let n = 0; n < options.delaiJours;) {
    day = addDays(day, 1);
    if (eligible(day, 'ouvres')) n += 1;
  }

  const out: Date[] = [];
  // Alternate morning and afternoon, and move along the window, so the offer looks natural.
  for (let i = 0; out.length < options.nombre && i < 60; i += 1, day = addDays(day, 1)) {
    if (!eligible(day, options.jours)) continue;
    const candidats: string[] = [];
    for (const [debut, fin] of options.plages) {
      for (let m = minutes(debut); m + duree <= minutes(fin); m += PAS_MIN) candidats.push(hhmm(m));
    }
    if (candidats.length === 0) break;
    const rotation = (out.length * 5) % candidats.length;
    const ordre = [...candidats.slice(rotation), ...candidats.slice(0, rotation)];
    const trouve = ordre
      .map((t) => zoned(day, t, options.fuseau))
      .find((d) => d.getTime() > maintenant.getTime() && libre(d));
    if (trouve) out.push(trouve);
  }
  return out;
}
