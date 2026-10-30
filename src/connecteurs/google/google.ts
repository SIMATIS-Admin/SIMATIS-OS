import { randomUUID } from 'node:crypto';
import type { SyncCtx } from '../../connexions/types.js';
import { logEvent } from '../../journal/service.js';
import type { Intervalle } from './creneaux.js';
import { accessToken, GoogleError, type FetchLike } from './oauth.js';

export type GoogleOptions = { fetch?: FetchLike };

export type Message = {
  id: string;
  // Fil Gmail du message : un brouillon de relance y est créé pour rester dans la conversation.
  threadId?: string;
  date: string | null;
  de: string | null;
  a: string | null;
  objet: string | null;
  extrait: string;
  corps?: string;
};

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const CALENDAR = 'https://www.googleapis.com/calendar/v3';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const DOCS = 'https://docs.googleapis.com/v1/documents';

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

  // The raw answer, for what is not JSON (an exported file) or not sent as JSON (an upload).
  async function raw(
    method: string,
    url: string,
    headers: Record<string, string>,
    body?: string | Buffer,
  ): Promise<Response> {
    const response = await doFetch(url, {
      method,
      headers: { authorization: `Bearer ${await bearer()}`, ...headers },
      body,
    });
    if (!response.ok) {
      const detail = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new GoogleError(
        `Google ${response.status}${detail.error?.message ? ` : ${detail.error.message}` : ''}`,
        response.status,
      );
    }
    return response;
  }

  async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
    const response = await raw(
      method,
      url,
      { 'content-type': 'application/json' },
      body === undefined ? undefined : JSON.stringify(body),
    );
    return (await response.json()) as T;
  }
  return { request, raw, check: bearer };
}

// A signature delimiter ("-- " line) and everything after it: Gmail adds Marc's own signature.
export function sansSignature(html: string): string {
  const cut = html.search(/(^|\n|<br\s*\/?>|<p>|<div>)\s*--\s*(\n|<br\s*\/?>|<\/p>|<\/div>|$)/i);
  return (cut === -1 ? html : html.slice(0, cut)).trimEnd();
}

const encodeHeader = (value: string) =>
  /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value).toString('base64')}?=`;

// Image incorporée au message (signature) : elle s'affiche dans le corps par `<img src="cid:…">`.
export type ImageIntegree = { cid: string; typeMime: string; base64: string };
export type BrouillonMessage = {
  to: string;
  subject: string;
  html: string;
  images?: ImageIntegree[];
};

const TYPES_IMAGE = ['image/png', 'image/jpeg'];

function partieImage({ cid, typeMime, base64 }: ImageIntegree): string[] {
  // Ces trois valeurs finissent dans des en-têtes ou dans le corps : on n'accepte que le sûr.
  if (!TYPES_IMAGE.includes(typeMime))
    throw new Error(`Type d'image non pris en charge : ${typeMime}`);
  if (!/^[A-Za-z0-9._-]{1,60}$/.test(cid)) throw new Error('Identifiant d’image invalide');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error('Image illisible');
  return [
    `Content-Type: ${typeMime}; name="${cid}"`,
    'Content-Transfer-Encoding: base64',
    `Content-ID: <${cid}>`,
    `Content-Disposition: inline; filename="${cid}"`,
    '',
    ...(base64.match(/.{1,76}/g) ?? []),
  ];
}

// The raw message, with any extra header lines (From, Date…) a mailbox other than Gmail needs.
// Sans image : une seule partie HTML. Avec images : multipart/related (HTML puis une partie par image).
export function mimeBrut(
  { to, subject, html, images = [] }: BrouillonMessage,
  entetes: string[] = [],
) {
  const entete = [
    ...entetes,
    // One line only: a line break in an address would add a header of its own (a hidden Bcc).
    `To: ${to.replace(/[\r\n]+/g, ' ')}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
  ];
  // Mail servers cut lines beyond 998 characters: base64 goes 76 per line.
  const corps =
    Buffer.from(sansSignature(html))
      .toString('base64')
      .match(/.{1,76}/g) ?? [];
  if (images.length === 0) {
    return [
      ...entete,
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      ...corps,
    ].join('\r\n');
  }
  const frontiere = `simatis-${randomUUID()}`;
  return [
    ...entete,
    `Content-Type: multipart/related; boundary="${frontiere}"`,
    '',
    `--${frontiere}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    ...corps,
    ...images.flatMap((image) => [`--${frontiere}`, ...partieImage(image)]),
    `--${frontiere}--`,
  ].join('\r\n');
}

export const mimeMessage = (draft: BrouillonMessage) =>
  Buffer.from(mimeBrut(draft)).toString('base64url');

// Draft in the instance's own Gmail, never sent: Marc reviews and sends it himself.
export async function createDraft(
  ctx: SyncCtx,
  draft: BrouillonMessage & { threadId?: string },
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
    // Avec un fil, le brouillon se range dans la conversation du contact.
    message: { raw: mimeMessage(draft), ...(draft.threadId ? { threadId: draft.threadId } : {}) },
  });
  await logEvent(ctx.tx, {
    acteur: 'os',
    action: `Brouillon Gmail créé : ${draft.subject}`,
    niveau: 'L1',
  });
  return { draftId: created.id, simulation: false };
}

// Envoi direct, choisi pour l'invitation au test VMA. Même garde que le brouillon : sans écritures
// réelles, rien ne part.
export async function sendMessage(
  ctx: SyncCtx,
  message: BrouillonMessage & { threadId?: string },
  options: GoogleOptions = {},
): Promise<{ simulation: boolean }> {
  if (!ctx.reel) {
    await logEvent(ctx.tx, {
      acteur: 'os',
      action: `Simulation : mail non envoyé (${message.subject})`,
    });
    return { simulation: true };
  }
  await googleApi(ctx, options).request<{ id: string }>('POST', `${GMAIL}/messages/send`, {
    raw: mimeMessage(message),
    // Avec un fil, le mail part dans la conversation du contact.
    ...(message.threadId ? { threadId: message.threadId } : {}),
  });
  await logEvent(ctx.tx, {
    acteur: 'os',
    action: `Mail envoyé : ${message.subject}`,
    niveau: 'L1',
  });
  return { simulation: false };
}

export const MIME_DOC = 'application/vnd.google-apps.document';
export const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MIME_DOSSIER = 'application/vnd.google-apps.folder';

export type FichierDrive = { id: string; nom: string; lien: string | null };
export type EcritureDrive = { fichier: FichierDrive | null; simulation: boolean };

type FichierBrut = { id: string; name?: string; webViewLink?: string };
const CHAMPS_FICHIER = 'id,name,webViewLink';
const fichierDe = (f: FichierBrut, repli: string): FichierDrive => ({
  id: f.id,
  nom: f.name ?? repli,
  lien: f.webViewLink ?? null,
});

// Same guard as a draft: without real writes the Drive stays untouched and the journal says so.
async function simulerDrive(ctx: SyncCtx, action: string): Promise<EcritureDrive> {
  await logEvent(ctx.tx, { acteur: 'os', action: `Simulation : ${action}` });
  return { fichier: null, simulation: true };
}

export async function creerDossier(
  ctx: SyncCtx,
  nom: string,
  parentId?: string,
  options: GoogleOptions = {},
): Promise<EcritureDrive> {
  if (!ctx.reel) return simulerDrive(ctx, `dossier Drive non créé (${nom})`);
  const created = await googleApi(ctx, options).request<FichierBrut>(
    'POST',
    `${DRIVE}/files?${new URLSearchParams({ fields: CHAMPS_FICHIER }).toString()}`,
    { name: nom, mimeType: MIME_DOSSIER, ...(parentId ? { parents: [parentId] } : {}) },
  );
  await logEvent(ctx.tx, { acteur: 'os', action: `Dossier Drive créé : ${nom}`, niveau: 'L1' });
  return { fichier: fichierDe(created, nom), simulation: false };
}

// Uploads a Word file and lets Drive convert it to a Google Doc (multipart: metadata, then bytes).
export async function envoyerEnDoc(
  ctx: SyncCtx,
  { nom, docx, dossierId }: { nom: string; docx: Buffer; dossierId?: string },
  options: GoogleOptions = {},
): Promise<EcritureDrive> {
  if (!ctx.reel) return simulerDrive(ctx, `Google Doc non créé (${nom})`);
  const boundary = `simatis-${randomUUID()}`;
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({
        name: nom,
        mimeType: MIME_DOC,
        ...(dossierId ? { parents: [dossierId] } : {}),
      })}\r\n--${boundary}\r\ncontent-type: ${MIME_DOCX}\r\n\r\n`,
    ),
    docx,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const response = await googleApi(ctx, options).raw(
    'POST',
    `${DRIVE_UPLOAD}/files?${new URLSearchParams({ uploadType: 'multipart', fields: CHAMPS_FICHIER }).toString()}`,
    { 'content-type': `multipart/related; boundary=${boundary}` },
    body,
  );
  await logEvent(ctx.tx, { acteur: 'os', action: `Google Doc créé : ${nom}`, niveau: 'L1' });
  return { fichier: fichierDe((await response.json()) as FichierBrut, nom), simulation: false };
}

// A copy keeps the previous version intact: each report version is its own Doc.
export async function copierFichier(
  ctx: SyncCtx,
  id: string,
  nom: string,
  options: GoogleOptions = {},
): Promise<EcritureDrive> {
  if (!ctx.reel) return simulerDrive(ctx, `copie Drive non créée (${nom})`);
  const copy = await googleApi(ctx, options).request<FichierBrut>(
    'POST',
    `${DRIVE}/files/${encodeURIComponent(id)}/copy?${new URLSearchParams({ fields: CHAMPS_FICHIER }).toString()}`,
    { name: nom },
  );
  await logEvent(ctx.tx, { acteur: 'os', action: `Copie Drive créée : ${nom}`, niveau: 'L1' });
  return { fichier: fichierDe(copy, nom), simulation: false };
}

// A Google Doc as a Word file. Read only, so no write lock.
export async function exporterDocx(
  ctx: Pick<SyncCtx, 'secrets' | 'instance'>,
  id: string,
  options: GoogleOptions = {},
): Promise<Buffer> {
  const response = await googleApi(ctx, options).raw(
    'GET',
    `${DRIVE}/files/${encodeURIComponent(id)}/export?${new URLSearchParams({ mimeType: MIME_DOCX }).toString()}`,
    {},
  );
  return Buffer.from(await response.arrayBuffer());
}

type ElementDoc = {
  paragraph?: { elements?: { textRun?: { content?: string } }[] };
  table?: { tableRows?: { tableCells?: { content?: ElementDoc[] }[] }[] };
};

// Tables are read cell by cell, a tab between cells, so a retouch sees the whole report text.
const texteDe = (elements: ElementDoc[] | undefined): string =>
  (elements ?? [])
    .map((e) =>
      e.table
        ? (e.table.tableRows ?? [])
            .map((row) => (row.tableCells ?? []).map((c) => texteDe(c.content).trim()).join('\t'))
            .join('\n')
        : (e.paragraph?.elements ?? []).map((p) => p.textRun?.content ?? '').join(''),
    )
    .join('');

export async function lireDoc(
  ctx: Pick<SyncCtx, 'secrets' | 'instance'>,
  id: string,
  options: GoogleOptions = {},
): Promise<{ titre: string; texte: string }> {
  const doc = await googleApi(ctx, options).request<{
    title?: string;
    body?: { content?: ElementDoc[] };
  }>('GET', `${DOCS}/${encodeURIComponent(id)}`);
  return { titre: doc.title ?? '', texte: texteDe(doc.body?.content) };
}

// Targeted edits (replace, insert, delete) sent as Docs API requests, without rewriting the Doc.
export async function modifierDoc(
  ctx: SyncCtx,
  id: string,
  requests: object[],
  options: GoogleOptions = {},
): Promise<{ simulation: boolean }> {
  if (!ctx.reel) {
    await simulerDrive(ctx, `Google Doc non modifié (${requests.length} modification(s))`);
    return { simulation: true };
  }
  await googleApi(ctx, options).request('POST', `${DOCS}/${encodeURIComponent(id)}:batchUpdate`, {
    requests,
  });
  await logEvent(ctx.tx, {
    acteur: 'os',
    action: `Google Doc modifié (${requests.length} modification(s))`,
    niveau: 'L1',
  });
  return { simulation: false };
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
      threadId?: string;
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
      ...(m.threadId ? { threadId: m.threadId } : {}),
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
  // The calendar it comes from, and the colour given to the event in Google Agenda (if any).
  agenda: string;
  couleur: string | null;
  // Opens the meeting in Google Agenda.
  lien: string | null;
};

// Google Agenda's fixed event palette (colorId 1 to 11), so a meeting keeps its Google colour.
const COULEURS_EVENEMENT: Record<string, string> = {
  '1': '#7986cb',
  '2': '#33b679',
  '3': '#8e24aa',
  '4': '#e67c73',
  '5': '#f6bf26',
  '6': '#f4511e',
  '7': '#039be5',
  '8': '#616161',
  '9': '#3f51b5',
  '10': '#0b8043',
  '11': '#d50000',
};

// Marks the Google copy of a meeting created in the OS, so reading the agenda can skip it.
const CLE_RDV_OS = 'simatisOs';

export type EcritureAgenda = {
  evenement: { id: string; lien: string | null } | null;
  simulation: boolean;
};

// Copy of a meeting created in the OS into the instance's main agenda. Same guard as a draft:
// without real writes the agenda stays untouched. It only creates; no existing event is touched.
export async function creerEvenement(
  ctx: SyncCtx,
  rdv: { osId: string; titre: string; debut: Date; fin: Date; lieu?: string | null },
  options: GoogleOptions = {},
): Promise<EcritureAgenda> {
  if (!ctx.reel) {
    await logEvent(ctx.tx, {
      acteur: 'os',
      action: `Simulation : rendez-vous non créé dans Google Agenda (${rdv.titre})`,
    });
    return { evenement: null, simulation: true };
  }
  const created = await googleApi(ctx, options).request<{ id: string; htmlLink?: string }>(
    'POST',
    `${CALENDAR}/calendars/primary/events`,
    {
      summary: rdv.titre,
      ...(rdv.lieu ? { location: rdv.lieu } : {}),
      start: { dateTime: rdv.debut.toISOString() },
      end: { dateTime: rdv.fin.toISOString() },
      extendedProperties: { private: { [CLE_RDV_OS]: rdv.osId } },
    },
  );
  await logEvent(ctx.tx, {
    acteur: 'os',
    action: `Rendez-vous créé dans Google Agenda : ${rdv.titre}`,
    niveau: 'L1',
  });
  return { evenement: { id: created.id, lien: created.htmlLink ?? null }, simulation: false };
}

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
          colorId?: string;
          extendedProperties?: { private?: Record<string, string> };
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
        // The copy of a meeting created in the OS: the OS already lists it under its own id.
        if (e.extendedProperties?.private?.[CLE_RDV_OS]) continue;
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
          agenda: id,
          couleur: COULEURS_EVENEMENT[e.colorId ?? ''] ?? null,
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

export type AgendaDisponible = {
  id: string;
  nom: string;
  principal: boolean;
  // reader, writer or owner: a calendar the account can only read is still shown.
  role: string;
  couleur: string | null;
};

// Every calendar the Google account can see: its own, the ones shared with it, the ones it
// subscribes to (KAIROS, OID…). The id is what the reading settings keep.
export async function agendasDisponibles(
  ctx: Pick<SyncCtx, 'secrets' | 'instance'>,
  options: GoogleOptions = {},
): Promise<AgendaDisponible[]> {
  const api = googleApi(ctx, options);
  const out: AgendaDisponible[] = [];
  let pageToken: string | undefined;
  do {
    const page = await api.request<{
      nextPageToken?: string;
      items?: {
        id?: string;
        summary?: string;
        summaryOverride?: string;
        primary?: boolean;
        accessRole?: string;
        backgroundColor?: string;
      }[];
    }>(
      'GET',
      `${CALENDAR}/users/me/calendarList?${new URLSearchParams({
        minAccessRole: 'reader',
        maxResults: '250',
        ...(pageToken ? { pageToken } : {}),
      }).toString()}`,
    );
    for (const c of page.items ?? []) {
      if (!c.id) continue;
      out.push({
        id: c.id,
        nom: c.summaryOverride ?? c.summary ?? c.id,
        principal: c.primary === true,
        role: c.accessRole ?? 'reader',
        couleur: c.backgroundColor ?? null,
      });
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
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
