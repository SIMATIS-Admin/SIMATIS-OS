import type { SyncCtx } from '../../connexions/types.js';
import { logEvent } from '../../journal/service.js';
import type { Intervalle } from './creneaux.js';
import { accessToken, GoogleError, type FetchLike } from './oauth.js';

export type GoogleOptions = { fetch?: FetchLike };

export type Message = {
  id: string;
  date: string | null;
  de: string | null;
  a: string | null;
  objet: string | null;
  extrait: string;
  corps?: string;
};

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const CALENDAR = 'https://www.googleapis.com/calendar/v3';

function credentials(ctx: Pick<SyncCtx, 'secrets' | 'instance'>) {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = ctx.secrets;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new GoogleError(
      `Messagerie non configurée pour ${ctx.instance.nom} : code secret Google de l'OS à enregistrer dans Paramètres > Connexions`,
      412,
    );
  }
  if (!GOOGLE_REFRESH_TOKEN) {
    throw new GoogleError(
      `Messagerie non configurée pour ${ctx.instance.nom} : cliquer sur « Connecter le compte Google » dans Paramètres > Connexions`,
      412,
    );
  }
  return {
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    refreshToken: GOOGLE_REFRESH_TOKEN,
  };
}

export function googleApi(ctx: Pick<SyncCtx, 'secrets' | 'instance'>, options: GoogleOptions = {}) {
  const doFetch = options.fetch ?? ((url, init) => fetch(url, init));
  let token: Promise<string> | undefined;
  const bearer = () => (token ??= accessToken(credentials(ctx), doFetch));

  async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
    const response = await doFetch(url, {
      method,
      headers: { authorization: `Bearer ${await bearer()}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const detail = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new GoogleError(
        `Google ${response.status}${detail.error?.message ? ` : ${detail.error.message}` : ''}`,
        response.status,
      );
    }
    return (await response.json()) as T;
  }
  return { request, check: bearer };
}

// A signature delimiter ("-- " line) and everything after it: Gmail adds Marc's own signature.
export function sansSignature(html: string): string {
  const cut = html.search(/(^|\n|<br\s*\/?>|<p>|<div>)\s*--\s*(\n|<br\s*\/?>|<\/p>|<\/div>|$)/i);
  return (cut === -1 ? html : html.slice(0, cut)).trimEnd();
}

const encodeHeader = (value: string) =>
  /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value).toString('base64')}?=`;

// The raw message, with any extra header lines (From, Date…) a mailbox other than Gmail needs.
export function mimeBrut(
  { to, subject, html }: { to: string; subject: string; html: string },
  entetes: string[] = [],
) {
  const lines = [
    ...entetes,
    // One line only: a line break in an address would add a header of its own (a hidden Bcc).
    `To: ${to.replace(/[\r\n]+/g, ' ')}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    // Mail servers cut lines beyond 998 characters: base64 goes 76 per line.
    ...(Buffer.from(sansSignature(html))
      .toString('base64')
      .match(/.{1,76}/g) ?? []),
  ];
  return lines.join('\r\n');
}

export const mimeMessage = (draft: { to: string; subject: string; html: string }) =>
  Buffer.from(mimeBrut(draft)).toString('base64url');

// Draft in the instance's own Gmail, never sent: Marc reviews and sends it himself.
export async function createDraft(
  ctx: SyncCtx,
  draft: { to: string; subject: string; html: string },
  options: GoogleOptions = {},
): Promise<{ draftId: string | null; simulation: boolean }> {
  if (!ctx.reel) {
    await logEvent(ctx.tx, {
      acteur: 'os',
      action: `Simulation : brouillon Gmail non créé (${draft.subject})`,
    });
    return { draftId: null, simulation: true };
  }
  const created = await googleApi(ctx, options).request<{ id: string }>('POST', `${GMAIL}/drafts`, {
    message: { raw: mimeMessage(draft) },
  });
  await logEvent(ctx.tx, {
    acteur: 'os',
    action: `Brouillon Gmail créé : ${draft.subject}`,
    niveau: 'L1',
  });
  return { draftId: created.id, simulation: false };
}

const header = (headers: { name: string; value: string }[] | undefined, name: string) =>
  headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;

// Recent exchanges with a contact. Snippets only, unless the instance reads full bodies.
export async function historique(
  ctx: Pick<SyncCtx, 'secrets' | 'instance'>,
  email: string,
  { mois, complet = false }: { mois: number; complet?: boolean },
  options: GoogleOptions = {},
): Promise<Message[]> {
  const api = googleApi(ctx, options);
  const q = `(from:${email} OR to:${email}) newer_than:${mois}m`;
  const list = await api.request<{ messages?: { id: string }[] }>(
    'GET',
    `${GMAIL}/messages?${new URLSearchParams({ q, maxResults: '25' }).toString()}`,
  );
  const out: Message[] = [];
  for (const { id } of list.messages ?? []) {
    const m = await api.request<{
      id: string;
      snippet?: string;
      payload?: {
        headers?: { name: string; value: string }[];
        body?: { data?: string };
        parts?: { mimeType: string; body?: { data?: string } }[];
      };
    }>(
      'GET',
      `${GMAIL}/messages/${id}?${new URLSearchParams(
        complet ? { format: 'full' } : { format: 'metadata', metadataHeaders: 'Subject' },
      ).toString()}&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date`,
    );
    const data =
      m.payload?.parts?.find((p) => p.mimeType === 'text/plain')?.body?.data ??
      m.payload?.body?.data;
    out.push({
      id: m.id,
      date: header(m.payload?.headers, 'Date'),
      de: header(m.payload?.headers, 'From'),
      a: header(m.payload?.headers, 'To'),
      objet: header(m.payload?.headers, 'Subject'),
      extrait: m.snippet ?? '',
      ...(complet && data ? { corps: Buffer.from(data, 'base64url').toString('utf8') } : {}),
    });
  }
  return out;
}

// Busy periods of the instance's calendars (to propose free slots, never to read the meetings).
export async function freeBusy(
  ctx: Pick<SyncCtx, 'secrets' | 'instance'>,
  debut: Date,
  fin: Date,
  calendriers: string[] = ['primary'],
  options: GoogleOptions = {},
): Promise<Intervalle[]> {
  const result = await googleApi(ctx, options).request<{
    calendars: Record<string, { busy?: { start: string; end: string }[] }>;
  }>('POST', `${CALENDAR}/freeBusy`, {
    timeMin: debut.toISOString(),
    timeMax: fin.toISOString(),
    timeZone: 'Europe/Paris',
    items: calendriers.map((id) => ({ id })),
  });
  return Object.values(result.calendars).flatMap((c) =>
    (c.busy ?? []).map((b) => ({ debut: new Date(b.start), fin: new Date(b.end) })),
  );
}

export type Evenement = {
  id: string;
  debut: Date;
  fin: Date;
  titre: string;
  lieu: string | null;
  // Guests' emails, to link a meeting to the instance's contacts.
  participants: string[];
  // All-day event (holiday, seminar): a date without a time.
  journee: boolean;
  // Opens the meeting in Google Agenda.
  lien: string | null;
};

// Meetings between two dates (brief, Rendez-vous screen).
export async function evenements(
  ctx: Pick<SyncCtx, 'secrets' | 'instance'>,
  debut: Date,
  fin: Date,
  calendriers: string[] = ['primary'],
  options: GoogleOptions = {},
): Promise<Evenement[]> {
  const api = googleApi(ctx, options);
  const out: Evenement[] = [];
  for (const id of calendriers) {
    // Google pages its answer: a busy month exceeds one page, so follow nextPageToken.
    let pageToken: string | undefined;
    do {
      const page = await api.request<{
        nextPageToken?: string;
        items?: {
          id?: string;
          summary?: string;
          location?: string;
          htmlLink?: string;
          attendees?: { email?: string; self?: boolean }[];
          start?: { dateTime?: string; date?: string };
          end?: { dateTime?: string; date?: string };
        }[];
      }>(
        'GET',
        `${CALENDAR}/calendars/${encodeURIComponent(id)}/events?${new URLSearchParams({
          timeMin: debut.toISOString(),
          timeMax: fin.toISOString(),
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: '250',
          ...(pageToken ? { pageToken } : {}),
        }).toString()}`,
      );
      for (const e of page.items ?? []) {
        const start = e.start?.dateTime ?? e.start?.date;
        const end = e.end?.dateTime ?? e.end?.date;
        if (!start || !end) continue;
        out.push({
          id: e.id ?? `${id}:${start}`,
          participants: (e.attendees ?? [])
            .filter((a) => !a.self && a.email)
            .map((a) => (a.email ?? '').toLowerCase()),
          debut: new Date(start),
          fin: new Date(end),
          titre: e.summary ?? '(sans titre)',
          lieu: e.location ?? null,
          journee: !e.start?.dateTime,
          lien: e.htmlLink ?? null,
        });
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
  }
  return out.sort((a, b) => a.debut.getTime() - b.debut.getTime());
}

type Headers = { name: string; value: string }[] | undefined;

// Address of the connected Gmail account: tells the pilot's own messages from the others.
export async function compteGmail(
  ctx: Pick<SyncCtx, 'secrets' | 'instance'>,
  options: GoogleOptions = {},
): Promise<string> {
  const p = await googleApi(ctx, options).request<{ emailAddress?: string }>(
    'GET',
    `${GMAIL}/profile`,
  );
  return (p.emailAddress ?? '').toLowerCase();
}

export type Fil = {
  threadId: string;
  de: string | null;
  date: string | null;
  objet: string | null;
  extrait: string;
};

// Recent inbox threads, each reduced to its last message (who wrote last decides "unanswered").
export async function filsRecents(
  ctx: Pick<SyncCtx, 'secrets' | 'instance'>,
  jours: number,
  options: GoogleOptions = {},
): Promise<Fil[]> {
  const api = googleApi(ctx, options);
  const list = await api.request<{ threads?: { id: string }[] }>(
    'GET',
    `${GMAIL}/threads?${new URLSearchParams({ q: `in:inbox newer_than:${jours}d`, maxResults: '100' }).toString()}`,
  );
  const out: Fil[] = [];
  for (const { id } of list.threads ?? []) {
    const t = await api.request<{
      messages?: { snippet?: string; payload?: { headers?: Headers } }[];
    }>(
      'GET',
      `${GMAIL}/threads/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
    );
    const dernier = t.messages?.at(-1);
    if (!dernier) continue;
    out.push({
      threadId: id,
      de: header(dernier.payload?.headers, 'From'),
      date: header(dernier.payload?.headers, 'Date'),
      objet: header(dernier.payload?.headers, 'Subject'),
      extrait: dernier.snippet ?? '',
    });
  }
  return out;
}

export type Brouillon = {
  draftId: string;
  objet: string | null;
  a: string | null;
  date: string | null;
};

export async function brouillons(
  ctx: Pick<SyncCtx, 'secrets' | 'instance'>,
  options: GoogleOptions = {},
): Promise<Brouillon[]> {
  const api = googleApi(ctx, options);
  const list = await api.request<{ drafts?: { id: string }[] }>(
    'GET',
    `${GMAIL}/drafts?maxResults=50`,
  );
  const out: Brouillon[] = [];
  for (const { id } of list.drafts ?? []) {
    const d = await api.request<{ message?: { payload?: { headers?: Headers } } }>(
      'GET',
      `${GMAIL}/drafts/${id}?format=metadata`,
    );
    const headers = d.message?.payload?.headers;
    out.push({
      draftId: id,
      objet: header(headers, 'Subject'),
      a: header(headers, 'To'),
      date: header(headers, 'Date'),
    });
  }
  return out;
}

// Account of the agenda connection (its primary calendar id): tells outsiders from colleagues.
export async function compteAgenda(
  ctx: Pick<SyncCtx, 'secrets' | 'instance'>,
  options: GoogleOptions = {},
): Promise<string> {
  const c = await googleApi(ctx, options).request<{ id?: string }>(
    'GET',
    `${CALENDAR}/calendars/primary`,
  );
  return (c.id ?? '').toLowerCase();
}
