// Week dates in Paris time, whatever the browser's time zone.
const FUSEAU = 'Europe/Paris';
const MOIS = [
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

const jourFmt = new Intl.DateTimeFormat('en-CA', { timeZone: FUSEAU });
const heureFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: FUSEAU,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export const jourParis = (iso: string) => jourFmt.format(new Date(iso));
export const heureParis = (iso: string) => heureFmt.format(new Date(iso));

// Offset of Paris from UTC at a given instant, in minutes.
function decalage(instant: number): number {
  const nom = new Intl.DateTimeFormat('en-US', { timeZone: FUSEAU, timeZoneName: 'longOffset' })
    .formatToParts(new Date(instant))
    .find((x) => x.type === 'timeZoneName')?.value;
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(nom ?? '');
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}

export const parisVersIso = (jour: string, hhmm: string) => {
  const [y, mo, d] = jour.split('-').map(Number) as [number, number, number];
  const [h, mi] = hhmm.split(':').map(Number) as [number, number];
  const naif = Date.UTC(y, mo - 1, d, h, mi);
  const premier = naif - decalage(naif) * 60_000;
  return new Date(naif - decalage(premier) * 60_000).toISOString();
};

// Same Paris time on another day (9:00 for a task without a due date).
export const memeHeure = (iso: string | null, jour: string) =>
  parisVersIso(jour, iso ? heureParis(iso) : '09:00');

const utc = (jour: string) => {
  const [y, m, d] = jour.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
};

// ISO 8601 week: the week of the year's first Thursday is week 1.
export function numeroSemaine(lundi: string): number {
  const jeudi = utc(lundi);
  jeudi.setUTCDate(jeudi.getUTCDate() + 3);
  const debut = Date.UTC(jeudi.getUTCFullYear(), 0, 1);
  return Math.floor((jeudi.getTime() - debut) / 86_400_000 / 7) + 1;
}

export function titreSemaine(lundi: string): string {
  const a = utc(lundi);
  const b = new Date(a);
  b.setUTCDate(b.getUTCDate() + 6);
  const [ja, ma, ya] = [a.getUTCDate(), MOIS[a.getUTCMonth()], a.getUTCFullYear()];
  const [jb, mb, yb] = [b.getUTCDate(), MOIS[b.getUTCMonth()], b.getUTCFullYear()];
  const debut = ya !== yb ? `${ja} ${ma} ${ya}` : ma !== mb ? `${ja} ${ma}` : `${ja}`;
  return `Semaine ${numeroSemaine(lundi)} · ${debut} – ${jb} ${mb} ${yb}`;
}

export function anciennete(iso: string, maintenant = new Date()): string {
  const jours = Math.round(
    (utc(jourParis(maintenant.toISOString())).getTime() - utc(jourParis(iso)).getTime()) /
      86_400_000,
  );
  if (jours <= 0) return "aujourd'hui";
  if (jours === 1) return 'hier';
  if (jours < 14) return `il y a ${jours} j`;
  if (jours < 60) return `il y a ${Math.floor(jours / 7)} sem.`;
  return `il y a ${Math.floor(jours / 30)} mois`;
}

// HubSpot gives tasks a default time: a time shared by three tasks or more is not a real one.
export function heuresParDefaut(echeances: (string | null)[]): Set<string> {
  const n = new Map<string, number>();
  for (const e of echeances) if (e) n.set(heureParis(e), (n.get(heureParis(e)) ?? 0) + 1);
  return new Set([...n].filter(([, k]) => k >= 3).map(([h]) => h));
}
