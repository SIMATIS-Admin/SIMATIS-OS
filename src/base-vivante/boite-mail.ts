import { googleApi, type GoogleOptions } from '../connecteurs/google/google.js';
import type { SyncCtx } from '../connexions/types.js';

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

export type MessageBoite = {
  id: string;
  labels: string[];
  de: string | null;
  a: string | null;
  cc: string | null;
  objet: string | null;
  date: Date | null;
  extrait: string;
  autoSubmitted: string | null;
  autoreply: string | null;
  failedRecipients: string | null;
  precedence: string | null;
};

export type ReponseLue = {
  messageId: string;
  date: Date;
  objet: string | null;
  extrait: string;
  auto: boolean;
};

export type ResumeAdresse = {
  envoyes: number;
  recus: number;
  dernierEnvoi: Date | null;
  dernierRecu: Date | null;
  bounce: boolean;
  reponses: ReponseLue[];
};

const EMAIL = /[a-z0-9._%+'-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;

export const adressesDe = (entete: string | null): string[] =>
  [...(entete ?? '').matchAll(EMAIL)].map((m) => m[0].toLowerCase());

const EXPEDITEUR_ERREUR = /mailer-daemon|postmaster/i;
const OBJET_ERREUR =
  /delivery status notification|undeliver|mail delivery (failed|subsystem)|returned mail|non remis|échec de (la )?remise|echec de (la )?remise|impossible de remettre/i;
const OBJET_AUTO =
  /réponse automatique|reponse automatique|automatic reply|auto[- ]?reply|absence du bureau|out of office|absent\(e\)|autoréponse/i;

// A bounce report quotes the original message (with all its recipients): only the failed
// recipient lines count, or else what precedes the quoted message.
export function adressesEnEchec(corps: string): string[] {
  const finales = [
    ...corps.matchAll(/(?:final|original)-recipient:\s*(?:rfc822;)?\s*(\S+)/gi),
  ].flatMap((m) => adressesDe(m[1] ?? ''));
  if (finales.length > 0) return finales;
  const coupe = corps.search(
    /message\/rfc822|original message|message d'origine|^-{3,}.*forwarded/im,
  );
  return adressesDe(coupe > 0 ? corps.slice(0, coupe) : corps);
}

export const estRetourEnErreur = (m: MessageBoite): boolean =>
  EXPEDITEUR_ERREUR.test(m.de ?? '') || OBJET_ERREUR.test(m.objet ?? '');

export const estReponseAuto = (m: MessageBoite): boolean =>
  (m.autoSubmitted !== null && !/^no$/i.test(m.autoSubmitted.trim())) ||
  m.autoreply !== null ||
  /auto_reply|auto-reply/i.test(m.precedence ?? '') ||
  OBJET_AUTO.test(m.objet ?? '');

// One pass over the messages of the period, reduced to what the base needs per known address:
// sent to, received from, bounced. `corpsErreur` reads the body of a bounce report (only those).
export async function analyser(
  messages: MessageBoite[],
  emails: Set<string>,
  compte: string,
  corpsErreur: (m: MessageBoite) => Promise<string>,
): Promise<Map<string, ResumeAdresse>> {
  const resume = new Map<string, ResumeAdresse>();
  const de = (email: string) => {
    let r = resume.get(email);
    if (!r) {
      r = {
        envoyes: 0,
        recus: 0,
        dernierEnvoi: null,
        dernierRecu: null,
        bounce: false,
        reponses: [],
      };
      resume.set(email, r);
    }
    return r;
  };
  for (const m of messages) {
    const expediteur = adressesDe(m.de)[0] ?? '';
    const date = m.date ?? new Date(0);
    if (estRetourEnErreur(m)) {
      const echecs = adressesDe(m.failedRecipients);
      const trouvees = echecs.length > 0 ? echecs : adressesEnEchec(await corpsErreur(m));
      for (const email of new Set(trouvees)) if (emails.has(email)) de(email).bounce = true;
      continue;
    }
    const envoye = m.labels.includes('SENT') || (compte !== '' && expediteur === compte);
    if (envoye) {
      for (const email of new Set([...adressesDe(m.a), ...adressesDe(m.cc)])) {
        if (!emails.has(email) || email === compte) continue;
        const r = de(email);
        r.envoyes++;
        if (!r.dernierEnvoi || date > r.dernierEnvoi) r.dernierEnvoi = date;
      }
    } else if (emails.has(expediteur)) {
      const r = de(expediteur);
      r.recus++;
      if (!r.dernierRecu || date > r.dernierRecu) r.dernierRecu = date;
      r.reponses.push({
        messageId: m.id,
        date,
        objet: m.objet,
        extrait: m.extrait,
        auto: estReponseAuto(m),
      });
    }
  }
  for (const r of resume.values()) r.reponses.sort((a, b) => b.date.getTime() - a.date.getTime());
  return resume;
}

type Entetes = { name: string; value: string }[] | undefined;
const entete = (h: Entetes, nom: string) =>
  h?.find((x) => x.name.toLowerCase() === nom.toLowerCase())?.value ?? null;

const jourGmail = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '/');

type MessageApi = {
  id: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: {
    headers?: Entetes;
    body?: { data?: string };
    parts?: { mimeType: string; body?: { data?: string }; parts?: unknown[] }[];
  };
};

const decoder = (data?: string) => (data ? Buffer.from(data, 'base64url').toString('utf8') : '');

const EN_TETES = [
  'From',
  'To',
  'Cc',
  'Subject',
  'Date',
  'Auto-Submitted',
  'X-Autoreply',
  'X-Failed-Recipients',
  'Precedence',
];

export type Progres = (lus: number, total: number) => void;

// Reads the mailbox of a mandate in read-only mode: headers only, in packets, from `depuis`.
export async function parcourirBoite(
  ctx: Pick<SyncCtx, 'secrets' | 'instance'>,
  depuis: Date,
  emails: Set<string>,
  compte: string,
  options: GoogleOptions & { concurrence?: number; progres?: Progres } = {},
): Promise<{ resume: Map<string, ResumeAdresse>; messages: number }> {
  const api = googleApi(ctx, options);
  const ids: string[] = [];
  let page: string | undefined;
  do {
    const params = new URLSearchParams({ q: `after:${jourGmail(depuis)}`, maxResults: '500' });
    if (page) params.set('pageToken', page);
    const liste = await api.request<{ messages?: { id: string }[]; nextPageToken?: string }>(
      'GET',
      `${GMAIL}/messages?${params.toString()}`,
    );
    ids.push(...(liste.messages ?? []).map((m) => m.id));
    page = liste.nextPageToken;
  } while (page);

  const messages: MessageBoite[] = [];
  let curseur = 0;
  const concurrence = options.concurrence ?? 8;
  const travailleur = async () => {
    for (;;) {
      const i = curseur++;
      const id = ids[i];
      if (id === undefined) return;
      const query = new URLSearchParams({ format: 'metadata' });
      for (const h of EN_TETES) query.append('metadataHeaders', h);
      const m = await api.request<MessageApi>('GET', `${GMAIL}/messages/${id}?${query.toString()}`);
      const h = m.payload?.headers;
      const date = entete(h, 'Date');
      messages.push({
        id: m.id,
        labels: m.labelIds ?? [],
        de: entete(h, 'From'),
        a: entete(h, 'To'),
        cc: entete(h, 'Cc'),
        objet: entete(h, 'Subject'),
        date:
          date && !Number.isNaN(Date.parse(date))
            ? new Date(date)
            : m.internalDate
              ? new Date(Number(m.internalDate))
              : null,
        extrait: m.snippet ?? '',
        autoSubmitted: entete(h, 'Auto-Submitted'),
        autoreply: entete(h, 'X-Autoreply'),
        failedRecipients: entete(h, 'X-Failed-Recipients'),
        precedence: entete(h, 'Precedence'),
      });
      options.progres?.(messages.length, ids.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrence, ids.length) }, travailleur));

  // The body of a bounce report names the address that failed: read only those messages in full.
  const corpsErreur = async (m: MessageBoite) => {
    const complet = await api.request<MessageApi>('GET', `${GMAIL}/messages/${m.id}?format=full`);
    const parties = [
      complet.payload?.body?.data,
      ...(complet.payload?.parts ?? []).map((p) => p.body?.data),
    ];
    return `${m.extrait} ${parties.map(decoder).join(' ')}`;
  };
  return {
    resume: await analyser(messages, emails, compte, corpsErreur),
    messages: messages.length,
  };
}
