// Week grid in Paris time, whatever the browser's time zone: columns Monday → Friday plus one
// weekend column, rows of 30 minutes from 8:00 (row 0) to 19:30 (row 23).
const FUSEAU = 'Europe/Paris';
export const LIGNES = 24;
export const COLONNES = 6;

const parts = new Intl.DateTimeFormat('en-GB', {
  timeZone: FUSEAU,
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const JOURS: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 5 };

// Row -1: a task due at midnight has no time of day (HubSpot stores dates that way).
export function creneau(iso: string): { jour: number; ligne: number } {
  const p = Object.fromEntries(parts.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  const h = Number(p.hour);
  const m = Number(p.minute);
  const jour = JOURS[p.weekday ?? 'Mon'] ?? 0;
  if (h === 0 && m === 0) return { jour, ligne: -1 };
  const ligne = (h - 8) * 2 + Math.floor(m / 30);
  return { jour, ligne: Math.min(LIGNES - 1, Math.max(0, ligne)) };
}

// Offset of Paris from UTC at a given instant, in minutes.
function decalage(instant: number): number {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: FUSEAU,
    timeZoneName: 'longOffset',
  }).formatToParts(new Date(instant));
  const off = f.find((x) => x.type === 'timeZoneName')?.value ?? 'GMT';
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(off);
  if (!match) return 0;
  return (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]));
}

// Slot of the week starting `lundi` (YYYY-MM-DD) → UTC ISO instant; the weekend column is Saturday.
export function vers(lundi: string, jour: number, ligne: number): string {
  const [y, mo, d] = lundi.split('-').map(Number) as [number, number, number];
  const minutes = 8 * 60 + Math.max(0, ligne) * 30;
  const naif = Date.UTC(y, mo - 1, d + jour, Math.floor(minutes / 60), minutes % 60);
  const premier = naif - decalage(naif) * 60_000;
  return new Date(naif - decalage(premier) * 60_000).toISOString();
}
