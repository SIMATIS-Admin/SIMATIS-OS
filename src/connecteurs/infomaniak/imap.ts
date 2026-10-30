import { randomUUID } from 'node:crypto';
import {
  ImapFlow,
  type FetchMessageObject,
  type FetchQueryObject,
  type MessageAddressObject,
  type MessageStructureObject,
  type SearchObject,
} from 'imapflow';
import type { SyncCtx } from '../../connexions/types.js';
import { logEvent } from '../../journal/service.js';
import { estAutomatique, type EnTetes } from '../envoi-automatique.js';
import {
  mimeBrut,
  type Brouillon,
  type BrouillonMessage,
  type Fil,
  type Message,
} from '../google/google.js';

// A mailbox read over IMAP (Infomaniak): same reads and the same single write (a draft, never a
// sent email) as the Gmail connector. One short connection per call, closed when it returns.

export class ImapError extends Error {}

type Ctx = Pick<SyncCtx, 'secrets' | 'instance'>;

export const SERVEUR_INFOMANIAK = { host: 'mail.infomaniak.com', port: 993, secure: true };

const JOUR = 864e5;
const MAX_EXTRAIT = 20_000;
const MAX_CORPS = 200_000;

async function avecBoite<T>(
  secrets: Record<string, string>,
  nom: string,
  fn: (client: ImapFlow, compte: string) => Promise<T>,
): Promise<T> {
  const { IMAP_USER, IMAP_PASSWORD } = secrets;
  if (!IMAP_USER || !IMAP_PASSWORD) {
    throw new ImapError(
      `Messagerie non configurée pour ${nom} : adresse et mot de passe d'appareil à enregistrer dans Paramètres > Connexions`,
    );
  }
  const host = secrets.IMAP_HOST ?? SERVEUR_INFOMANIAK.host;
  const client = new ImapFlow({
    host,
    port: Number(secrets.IMAP_PORT ?? SERVEUR_INFOMANIAK.port),
    secure: secrets.IMAP_SECURE !== 'non',
    auth: { user: IMAP_USER, pass: IMAP_PASSWORD },
    logger: false,
    connectionTimeout: 15_000,
  });
  // A dropped socket is reported by the pending command: without a listener it would crash the OS.
  client.on('error', () => undefined);
  try {
    await client.connect();
  } catch (error) {
    throw new ImapError(
      (error as { authenticationFailed?: boolean }).authenticationFailed
        ? "La boîte mail refuse cette adresse ou ce mot de passe d'appareil."
        : `Boîte mail injoignable (${host}) : vérifiez la connexion internet.`,
      { cause: error },
    );
  }
  try {
    return await fn(client, IMAP_USER.toLowerCase());
  } finally {
    await client.logout().catch(() => undefined);
  }
}

const dossier = async (client: ImapFlow, usage: '\\Sent' | '\\Drafts') =>
  (await client.list()).find((b) => b.specialUse === usage)?.path ?? null;

async function dansDossier<T>(client: ImapFlow, path: string, fn: () => Promise<T>): Promise<T> {
  const lock = await client.getMailboxLock(path, { readOnly: true });
  try {
    return await fn();
  } finally {
    lock.release();
  }
}

type Lu = FetchMessageObject & { path: string };

async function lire(
  client: ImapFlow,
  path: string,
  critere: SearchObject,
  champs: FetchQueryObject,
): Promise<Lu[]> {
  return dansDossier(client, path, async () => {
    const uids = await client.search(critere, { uid: true });
    if (!uids || uids.length === 0) return [];
    const lus = await client.fetchAll(uids, { ...champs, uid: true }, { uid: true });
    return lus.map((m) => ({ ...m, path }));
  });
}

const adresse = (a: MessageAddressObject[] | undefined): string | null => {
  const [premier] = a ?? [];
  if (!premier?.address) return null;
  return premier.name ? `${premier.name} <${premier.address}>` : premier.address;
};

const dateDe = (m: FetchMessageObject) => {
  const d = new Date(m.envelope?.date ?? m.internalDate ?? Number.NaN);
  return Number.isNaN(d.getTime()) ? null : d;
};

const feuilles = (n: MessageStructureObject): MessageStructureObject[] =>
  n.childNodes ? n.childNodes.flatMap(feuilles) : [n];

const ENTITES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

// The message's text (its plain part, else its HTML without tags), never its attachments. Must
// run while the message's folder is open.
async function texte(client: ImapFlow, m: FetchMessageObject, max: number): Promise<string> {
  const parts = m.bodyStructure
    ? feuilles(m.bodyStructure).filter((p) => p.disposition !== 'attachment')
    : [];
  const part =
    parts.find((p) => p.type === 'text/plain') ?? parts.find((p) => p.type === 'text/html');
  if (!part) return '';
  const d = await client.download(String(m.uid), part.part ?? '1', { uid: true, maxBytes: max });
  if (!d.content) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of d.content) chunks.push(chunk as Buffer);
  const brut = Buffer.concat(chunks).toString('utf8');
  if (part.type !== 'text/html') return brut;
  return brut
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (e) => ENTITES[e] ?? e);
}

const extraitDe = (t: string) => t.replace(/\s+/g, ' ').trim().slice(0, 200);

// Recent exchanges with a contact, received and sent. Snippets only, unless the instance reads
// full bodies.
export async function historique(
  ctx: Ctx,
  email: string,
  { mois, complet = false }: { mois: number; complet?: boolean },
): Promise<Message[]> {
  return avecBoite(ctx.secrets, ctx.instance.nom, async (client) => {
    const since = new Date();
    since.setMonth(since.getMonth() - mois);
    const critere = { since, or: [{ from: email }, { to: email }] };
    const envoyes = await dossier(client, '\\Sent');
    const lus: Lu[] = [];
    for (const path of ['INBOX', ...(envoyes ? [envoyes] : [])]) {
      lus.push(...(await lire(client, path, critere, { envelope: true, bodyStructure: true })));
    }
    const recents = lus
      .sort((a, b) => (dateDe(b)?.getTime() ?? 0) - (dateDe(a)?.getTime() ?? 0))
      .slice(0, 25);
    const out: Message[] = [];
    for (const m of recents) {
      const corps = await dansDossier(client, m.path, () =>
        texte(client, m, complet ? MAX_CORPS : MAX_EXTRAIT),
      );
      out.push({
        id: m.envelope?.messageId ?? `${m.path}:${m.uid}`,
        date: dateDe(m)?.toISOString() ?? null,
        de: adresse(m.envelope?.from),
        a: adresse(m.envelope?.to),
        objet: m.envelope?.subject ?? null,
        extrait: extraitDe(corps),
        ...(complet && corps ? { corps } : {}),
      });
    }
    return out;
  });
}

// The raw header block as name/value pairs (folded lines joined).
const entetes = (m: FetchMessageObject): EnTetes =>
  (m.headers?.toString('utf8') ?? '')
    .replace(/\r?\n[ \t]+/g, ' ')
    .split(/\r?\n/)
    .flatMap((l) => {
      const i = l.indexOf(':');
      return i > 0 ? [{ name: l.slice(0, i).trim(), value: l.slice(i + 1).trim() }] : [];
    });

const references = (m: FetchMessageObject): string[] =>
  entetes(m)
    .filter((e) => e.name.toLowerCase() === 'references')
    .flatMap((e) => e.value.match(/<[^>\s]+>/g) ?? []);

// Recent inbox threads, each reduced to its last message, sent ones included (who wrote last
// decides "unanswered"). IMAP has no threads: messages are grouped by the root they refer to.
export async function filsRecents(ctx: Ctx, jours: number): Promise<Fil[]> {
  return avecBoite(ctx.secrets, ctx.instance.nom, async (client) => {
    const critere = { since: new Date(Date.now() - jours * JOUR) };
    const champs = {
      envelope: true,
      bodyStructure: true,
      headers: [
        'references',
        'list-unsubscribe',
        'precedence',
        'auto-submitted',
        'x-auto-response-suppress',
      ],
    };
    const envoyes = await dossier(client, '\\Sent');
    const lus = [
      ...(await lire(client, 'INBOX', critere, champs)),
      ...(envoyes ? await lire(client, envoyes, critere, champs) : []),
    ];
    const idDe = (m: Lu) => m.envelope?.messageId ?? `${m.path}:${m.uid}`;
    const parent = new Map(
      lus.map((m) => [idDe(m), references(m)[0] ?? m.envelope?.inReplyTo ?? null]),
    );
    // A reply quoting only its direct parent still joins the thread of that parent's root.
    const racine = (id: string) => {
      let cle = id;
      for (let k = 0; k < 20; k += 1) {
        const p = parent.get(cle);
        if (!p) break;
        cle = p;
      }
      return cle;
    };
    const fils = new Map<string, Lu[]>();
    for (const m of lus) {
      const cle = racine(idDe(m));
      fils.set(cle, [...(fils.get(cle) ?? []), m]);
    }
    const derniers = [...fils.entries()]
      .filter(([, messages]) => messages.some((m) => m.path === 'INBOX'))
      .map(([threadId, messages]) => ({
        threadId,
        dernier: messages.reduce((a, b) =>
          (dateDe(b)?.getTime() ?? 0) >= (dateDe(a)?.getTime() ?? 0) ? b : a,
        ),
      }))
      .sort((a, b) => (dateDe(b.dernier)?.getTime() ?? 0) - (dateDe(a.dernier)?.getTime() ?? 0))
      .slice(0, 100);
    const out: Fil[] = [];
    for (const { threadId, dernier } of derniers) {
      out.push({
        threadId,
        de: adresse(dernier.envelope?.from),
        date: dateDe(dernier)?.toISOString() ?? null,
        objet: dernier.envelope?.subject ?? null,
        extrait: extraitDe(
          await dansDossier(client, dernier.path, () => texte(client, dernier, MAX_EXTRAIT)),
        ),
        a: (dernier.envelope?.to ?? []).flatMap((x) =>
          x.address ? [x.address.toLowerCase()] : [],
        ),
        automatique: estAutomatique(entetes(dernier), adresse(dernier.envelope?.from)),
      });
    }
    return out;
  });
}

export async function brouillons(ctx: Ctx): Promise<Brouillon[]> {
  return avecBoite(ctx.secrets, ctx.instance.nom, async (client) => {
    const path = await dossier(client, '\\Drafts');
    if (!path) return [];
    const lus = await lire(client, path, { all: true }, { envelope: true });
    return lus.slice(-50).map((m) => ({
      draftId: String(m.uid),
      objet: m.envelope?.subject ?? null,
      a: adresse(m.envelope?.to),
      date: dateDe(m)?.toISOString() ?? null,
    }));
  });
}

// Checks the address and its device password: throws a readable error.
export async function verifier(secrets: Record<string, string>, nom = 'cette instance') {
  await avecBoite(secrets, nom, () => Promise.resolve());
}

// Draft in the instance's own mailbox, never sent: the pilot reviews and sends it himself.
export async function createDraft(
  ctx: SyncCtx,
  draft: BrouillonMessage,
): Promise<{ draftId: string | null; simulation: boolean }> {
  if (!ctx.reel) {
    await logEvent(ctx.tx, {
      acteur: 'os',
      action: `Simulation : brouillon non créé dans la boîte mail (${draft.subject})`,
    });
    return { draftId: null, simulation: true };
  }
  const uid = await avecBoite(ctx.secrets, ctx.instance.nom, async (client, compte) => {
    const path = await dossier(client, '\\Drafts');
    if (!path) throw new ImapError('Dossier des brouillons introuvable dans la boîte mail.');
    const brut = mimeBrut(draft, [
      `From: ${compte}`,
      `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
      `Message-ID: <${randomUUID()}@${compte.split('@')[1] ?? 'simatis-os'}>`,
    ]);
    const cree = await client.append(path, brut, ['\\Draft', '\\Seen']);
    if (!cree) throw new ImapError('La boîte mail a refusé le brouillon.');
    return cree.uid ?? null;
  });
  await logEvent(ctx.tx, {
    acteur: 'os',
    action: `Brouillon créé dans la boîte mail : ${draft.subject}`,
    niveau: 'L1',
  });
  return { draftId: uid === null ? null : String(uid), simulation: false };
}
