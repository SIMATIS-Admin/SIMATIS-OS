import { and, count, eq, gte, lt } from 'drizzle-orm';
import { z } from 'zod';
import { accessToken, GoogleError, type FetchLike } from '../connecteurs/google/oauth.js';
import type { Database } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import { sujets } from '../inbox/schema.js';
import { instances, type Instance } from '../instances/schema.js';
import { logEvent } from '../journal/service.js';
import { loadInstanceSecrets } from '../secrets.js';

// Site web screen: the website's audience read from Google Analytics 4, read-only, on demand.
// A brick of its own (module site-web): SIMATIS's instance first, a client's later.

export const MODULE_SITE_WEB = 'site-web';
export const siteWebActif = (instance: Instance) =>
  (instance.config.modules ?? []).includes(MODULE_SITE_WEB);

export class SiteWebIndisponible extends Error {}

const ADMIN = 'https://analyticsadmin.googleapis.com/v1beta';
const DATA = 'https://analyticsdata.googleapis.com/v1beta';
const CACHE_MS = 60 * 60_000;
// Four full weeks: smooths the weekly cycle of a B2B site, still recent enough to act on.
export const JOURS_PERIODE = 28;

export type Propriete = { id: string; nom: string; compte: string };

export type Indicateurs = {
  visiteurs: number;
  nouveaux: number;
  sessions: number;
  // Share of sessions longer than 10 s, or with 2 pages or more, or a key event (0 to 1).
  engagement: number;
  dureeMoyenne: number;
  pagesVues: number;
};

export type RapportSite = {
  periode: { du: string; au: string };
  precedente: { du: string; au: string };
  actuel: Indicateurs;
  precedent: Indicateurs;
  // Contact-form requests received by the OS (Inbox, origin `site`) over each period.
  demandes: { actuel: number; precedent: number };
  mois: { mois: string; visiteurs: number; sessions: number }[];
  canaux: { canal: string; sessions: number; engagement: number }[];
  pages: { chemin: string; titre: string; vues: number; visiteurs: number }[];
  sources: { source: string; sessions: number }[];
  genereLe: string;
};

const jourParis = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(d);
const decaler = (jour: string, jours: number) => {
  const d = new Date(`${jour}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
};

// Last 28 full days (today is still filling up) against the 28 before, and twelve calendar months
// for the trend (the current one partial).
export function periodes(now: Date) {
  const au = decaler(jourParis(now), -1);
  const du = decaler(au, -(JOURS_PERIODE - 1));
  const precedente = { du: decaler(du, -JOURS_PERIODE), au: decaler(du, -1) };
  const [annee, mois] = jourParis(now).split('-').map(Number) as [number, number];
  const debut = new Date(Date.UTC(annee, mois - 1 - 11, 1)).toISOString().slice(0, 10);
  return { periode: { du, au }, precedente, douzeMois: { du: debut, au } };
}

// Google's channel groups, in the screen's language.
const CANAUX: Record<string, string> = {
  'Organic Search': 'Recherche Google et autres moteurs',
  Direct: 'Accès direct',
  'Organic Social': 'Réseaux sociaux',
  'Paid Social': 'Réseaux sociaux (payant)',
  Referral: 'Liens depuis d’autres sites',
  Email: 'Emails',
  'Paid Search': 'Recherche payante',
  Display: 'Bannières',
  'Organic Video': 'Vidéo',
  Unassigned: 'Non attribué',
  'Cross-network': 'Campagnes multi-réseaux',
};
export const libelleCanal = (canal: string) => CANAUX[canal] ?? canal;

const rapportSchema = z.object({
  dimensionHeaders: z.array(z.object({ name: z.string() })).optional(),
  metricHeaders: z.array(z.object({ name: z.string() })).optional(),
  rows: z
    .array(
      z.object({
        dimensionValues: z.array(z.object({ value: z.string() })).optional(),
        metricValues: z.array(z.object({ value: z.string() })).optional(),
      }),
    )
    .optional(),
});
type Rapport = z.infer<typeof rapportSchema>;

// One GA4 report as plain rows: { dimension or metric name: value }.
export function lignes(rapport: Rapport): Record<string, string>[] {
  const dims = (rapport.dimensionHeaders ?? []).map((h) => h.name);
  const mets = (rapport.metricHeaders ?? []).map((h) => h.name);
  return (rapport.rows ?? []).map((r) => {
    const out: Record<string, string> = {};
    dims.forEach((n, k) => (out[n] = r.dimensionValues?.[k]?.value ?? ''));
    mets.forEach((n, k) => (out[n] = r.metricValues?.[k]?.value ?? '0'));
    return out;
  });
}

const nombre = (v: string | undefined) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const METRIQUES = [
  'activeUsers',
  'newUsers',
  'sessions',
  'engagementRate',
  'averageSessionDuration',
  'screenPageViews',
];

const indicateurs = (l: Record<string, string> | undefined): Indicateurs => ({
  visiteurs: nombre(l?.activeUsers),
  nouveaux: nombre(l?.newUsers),
  sessions: nombre(l?.sessions),
  engagement: nombre(l?.engagementRate),
  dureeMoyenne: nombre(l?.averageSessionDuration),
  pagesVues: nombre(l?.screenPageViews),
});

export function requetes(p: ReturnType<typeof periodes>) {
  const periode = { startDate: p.periode.du, endDate: p.periode.au };
  const parDesc = (metricName: string) => [{ metric: { metricName }, desc: true }];
  return [
    {
      dateRanges: [
        { ...periode, name: 'actuel' },
        { startDate: p.precedente.du, endDate: p.precedente.au, name: 'precedent' },
      ],
      metrics: METRIQUES.map((name) => ({ name })),
    },
    {
      dateRanges: [{ startDate: p.douzeMois.du, endDate: p.douzeMois.au }],
      dimensions: [{ name: 'yearMonth' }],
      metrics: [{ name: 'activeUsers' }, { name: 'sessions' }],
      orderBys: [{ dimension: { dimensionName: 'yearMonth' } }],
    },
    {
      dateRanges: [periode],
      dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics: [{ name: 'sessions' }, { name: 'engagementRate' }],
      orderBys: parDesc('sessions'),
      limit: 10,
    },
    {
      dateRanges: [periode],
      dimensions: [{ name: 'pagePath' }, { name: 'pageTitle' }],
      metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }],
      orderBys: parDesc('screenPageViews'),
      limit: 10,
    },
    {
      dateRanges: [periode],
      dimensions: [{ name: 'sessionSource' }],
      metrics: [{ name: 'sessions' }],
      orderBys: parDesc('sessions'),
      limit: 8,
    },
  ];
}

// The five reports of requetes(), in order, turned into the screen's figures.
export function assembler(
  reports: Rapport[],
  p: ReturnType<typeof periodes>,
  demandes: RapportSite['demandes'],
  now: Date,
): RapportSite {
  const [kpi, mois, canaux, pages, sources] = reports.map(lignes);
  // Two named date ranges: GA adds a dateRange dimension carrying each range's name.
  const parPeriode = (nom: string) => kpi?.find((l) => l.dateRange === nom);
  return {
    periode: p.periode,
    precedente: p.precedente,
    actuel: indicateurs(parPeriode('actuel')),
    precedent: indicateurs(parPeriode('precedent')),
    demandes,
    mois: (mois ?? []).map((l) => ({
      mois: `${l.yearMonth?.slice(0, 4)}-${l.yearMonth?.slice(4, 6)}`,
      visiteurs: nombre(l.activeUsers),
      sessions: nombre(l.sessions),
    })),
    canaux: (canaux ?? []).map((l) => ({
      canal: libelleCanal(l.sessionDefaultChannelGroup ?? ''),
      sessions: nombre(l.sessions),
      engagement: nombre(l.engagementRate),
    })),
    pages: (pages ?? []).map((l) => ({
      chemin: l.pagePath ?? '',
      titre: l.pageTitle ?? '',
      vues: nombre(l.screenPageViews),
      visiteurs: nombre(l.activeUsers),
    })),
    sources: (sources ?? []).map((l) => ({
      source: l.sessionSource ?? '',
      sessions: nombre(l.sessions),
    })),
    genereLe: now.toISOString(),
  };
}

// Google's refusals, in words Marc can act on.
export function messageLisible(error: unknown): string {
  const brut = error instanceof Error ? error.message : String(error);
  if (/has not been used|SERVICE_DISABLED|is disabled/i.test(brut)) {
    return 'Les API Google Analytics ne sont pas activées dans le projet Google de l’OS : voir docs/EXPLOITATION.md, « Site web ».';
  }
  if (/invalid_grant/i.test(brut)) {
    return 'L’autorisation Google Analytics a expiré ou a été retirée : reconnectez le compte.';
  }
  if (error instanceof GoogleError && error.status === 403) {
    return 'Ce compte Google n’a pas accès à cette propriété Analytics : choisissez-en une autre ou connectez un autre compte.';
  }
  return `Google Analytics injoignable (${brut}).`;
}

export type SiteWebDeps = { secretsDir: string; fetch?: FetchLike; now?: () => Date };

export function siteWebService(deps: SiteWebDeps) {
  const doFetch: FetchLike = deps.fetch ?? ((url, init) => fetch(url, init));
  const now = deps.now ?? (() => new Date());
  const cache = new Map<string, { at: number; rapport: RapportSite }>();

  async function secretsOf(instance: Instance) {
    return loadInstanceSecrets(deps.secretsDir, instance.slug);
  }

  async function client(instance: Instance) {
    const s = await secretsOf(instance);
    if (!s.GOOGLE_CLIENT_ID || !s.GOOGLE_CLIENT_SECRET || !s.GOOGLE_ANALYTICS_REFRESH_TOKEN) {
      throw new SiteWebIndisponible('Compte Google Analytics non connecté.');
    }
    const token = await accessToken(
      {
        clientId: s.GOOGLE_CLIENT_ID,
        clientSecret: s.GOOGLE_CLIENT_SECRET,
        refreshToken: s.GOOGLE_ANALYTICS_REFRESH_TOKEN,
      },
      doFetch,
    );
    return async <T>(method: string, url: string, body?: unknown): Promise<T> => {
      const response = await doFetch(url, {
        method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) {
        const detail = (await response.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new GoogleError(
          `Google ${response.status}${detail.error?.message ? ` : ${detail.error.message}` : ''}`,
          response.status,
        );
      }
      return (await response.json()) as T;
    };
  }

  // Calls Google, turning its refusals into SiteWebIndisponible with a readable message.
  async function lisible<T>(f: () => Promise<T>): Promise<T> {
    try {
      return await f();
    } catch (error) {
      if (error instanceof SiteWebIndisponible) throw error;
      throw new SiteWebIndisponible(messageLisible(error));
    }
  }

  return {
    async etat(instance: Instance) {
      const s = await secretsOf(instance);
      return {
        googleClientDisponible: !!(s.GOOGLE_CLIENT_ID && s.GOOGLE_CLIENT_SECRET),
        connecte: !!s.GOOGLE_ANALYTICS_REFRESH_TOKEN,
        propriete: instance.config.siteWeb ?? null,
      };
    },

    // GA4 properties the connected account can read, to pick the website's one.
    proprietes(instance: Instance): Promise<Propriete[]> {
      return lisible(async () => {
        const request = await client(instance);
        const out: Propriete[] = [];
        let pageToken: string | undefined;
        do {
          const page = await request<{
            nextPageToken?: string;
            accountSummaries?: {
              displayName?: string;
              propertySummaries?: { property?: string; displayName?: string }[];
            }[];
          }>(
            'GET',
            `${ADMIN}/accountSummaries?${new URLSearchParams({
              pageSize: '200',
              ...(pageToken ? { pageToken } : {}),
            }).toString()}`,
          );
          for (const compte of page.accountSummaries ?? []) {
            for (const p of compte.propertySummaries ?? []) {
              const id = p.property?.replace(/^properties\//, '');
              if (id) out.push({ id, nom: p.displayName ?? id, compte: compte.displayName ?? '' });
            }
          }
          pageToken = page.nextPageToken;
        } while (pageToken);
        return out;
      });
    },

    async choisirPropriete(db: Database, instance: Instance, p: { id: string; nom: string }) {
      const config = { ...instance.config, siteWeb: { proprieteId: p.id, proprieteNom: p.nom } };
      await withInstance(db, instance.id, async (tx) => {
        await tx
          .update(instances)
          .set({ config, updatedAt: new Date() })
          .where(eq(instances.id, instance.id));
        await logEvent(tx, {
          acteur: 'pilote',
          action: `Site web : propriété Google Analytics choisie (${p.nom})`,
        });
      });
      for (const key of cache.keys()) if (key.startsWith(`${instance.slug}:`)) cache.delete(key);
      return config.siteWeb;
    },

    // Kept an hour: the figures are daily, and Google limits the number of requests.
    async rapport(db: Database, instance: Instance, frais = false): Promise<RapportSite> {
      const propriete = instance.config.siteWeb?.proprieteId;
      if (!propriete) throw new SiteWebIndisponible('Aucune propriété Google Analytics choisie.');
      const key = `${instance.slug}:${propriete}`;
      const t = now();
      const hit = cache.get(key);
      if (hit && !frais && t.getTime() - hit.at < CACHE_MS) return hit.rapport;

      const p = periodes(t);
      const reports = await lisible(async () => {
        const request = await client(instance);
        const res = await request<{ reports?: unknown[] }>(
          'POST',
          `${DATA}/properties/${encodeURIComponent(propriete)}:batchRunReports`,
          { requests: requetes(p) },
        );
        return z.array(rapportSchema).parse(res.reports ?? []);
      });
      const demandes = {
        actuel: await demandesSite(db, instance, p.periode),
        precedent: await demandesSite(db, instance, p.precedente),
      };
      const rapport = assembler(reports, p, demandes, t);
      cache.set(key, { at: t.getTime(), rapport });
      return rapport;
    },
  };
}

// Contact-form requests the OS picked up from the website (site/releve.ts) between two days.
export async function demandesSite(
  db: Database,
  instance: Instance,
  { du, au }: { du: string; au: string },
): Promise<number> {
  return withInstance(db, instance.id, async (tx) => {
    const [row] = await tx
      .select({ n: count() })
      .from(sujets)
      .where(
        and(
          eq(sujets.instanceId, currentInstance),
          eq(sujets.origine, 'site'),
          gte(sujets.createdAt, new Date(`${du}T00:00:00Z`)),
          lt(sujets.createdAt, new Date(`${decaler(au, 1)}T00:00:00Z`)),
        ),
      );
    return row?.n ?? 0;
  });
}
