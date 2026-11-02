import { and, eq, inArray } from 'drizzle-orm';
import { messagerieDe, type Messagerie } from '../connecteurs/messagerie.js';
import { connexions } from '../connexions/schema.js';
import type { ConnexionDeps } from '../connexions/service.js';
import type { Database } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { loadInstanceSecrets } from '../secrets.js';
import type { Evenement, Kind } from './fiches.js';
import { lireLiens } from './liens.js';
import { contactEmails } from './schema.js';

// Mails exchanged with a record, read live from the instance's mailbox: nothing is copied into
// the database, so the history is as long as the mailbox and no mail content is stored.
export type MailsFiche = { mails: Evenement[]; adresses: number; message?: string };

const MOIS = 120;
const PAR_ADRESSE = 40;
const ADRESSES_MAX = 10;

// Addresses of the contacts in scope: the contact itself, or those of a company or a deal.
async function adressesDeFiche(db: Database, instance: Instance, kind: Kind, id: string) {
  return withInstance(db, instance.id, async (tx) => {
    const contacts =
      kind === 'contact' ? [id] : (await lireLiens(tx, kind, id)).contacts.map((c) => c.id);
    if (!contacts.length) return [];
    const rows = await tx
      .select({ email: contactEmails.email })
      .from(contactEmails)
      .where(
        and(
          eq(contactEmails.instanceId, currentInstance),
          inArray(contactEmails.contactId, contacts),
        ),
      );
    return [...new Set(rows.map((r) => r.email))].slice(0, ADRESSES_MAX);
  });
}

async function boiteDeInstance(db: Database, instance: Instance, deps: ConnexionDeps) {
  const [c] = await withInstance(db, instance.id, (tx) =>
    tx
      .select({ fournisseur: connexions.fournisseur, etat: connexions.etat })
      .from(connexions)
      .where(and(eq(connexions.instanceId, currentInstance), eq(connexions.kind, 'messagerie'))),
  );
  if (!c || c.etat === 'non_configuree' || !['gmail', 'infomaniak'].includes(c.fournisseur))
    return null;
  const secrets = await loadInstanceSecrets(deps.secretsDir, instance.slug);
  return messagerieDe(c.fournisseur, { instance, secrets });
}

// Sent and received mails of the addresses, newest first, one line per message.
export async function mailsEchanges(boite: Messagerie, adresses: string[]): Promise<Evenement[]> {
  const compte = (await boite.compte()).toLowerCase();
  const vus = new Map<string, Evenement>();
  for (const adresse of adresses) {
    for (const m of await boite.historique(adresse, { mois: MOIS, max: PAR_ADRESSE })) {
      const at = m.date ? new Date(m.date) : null;
      if (!at || Number.isNaN(at.getTime()) || vus.has(m.id)) continue;
      const envoye = compte !== '' && (m.de ?? '').toLowerCase().includes(compte);
      vus.set(m.id, {
        id: `mail-${m.id}`,
        type: 'email',
        titre: `${envoye ? 'Envoyé' : 'Reçu'} · ${m.objet?.trim() || '(sans objet)'}`,
        texte: m.extrait || null,
        at: at.toISOString(),
        origine: 'os',
      });
    }
  }
  return [...vus.values()].sort((x, y) => y.at.localeCompare(x.at));
}

export async function mailsDeFiche(
  db: Database,
  instance: Instance,
  kind: Kind,
  id: string,
  deps: ConnexionDeps,
  boiteDe: (
    db: Database,
    i: Instance,
    d: ConnexionDeps,
  ) => Promise<Messagerie | null> = boiteDeInstance,
): Promise<MailsFiche> {
  const adresses = await adressesDeFiche(db, instance, kind, id);
  if (!adresses.length)
    return { mails: [], adresses: 0, message: 'Aucune adresse email sur cette fiche.' };
  const boite = await boiteDe(db, instance, deps);
  if (!boite)
    return {
      mails: [],
      adresses: adresses.length,
      message: 'Aucune messagerie connectée à cette instance (Paramètres > Connexions).',
    };
  try {
    return { mails: await mailsEchanges(boite, adresses), adresses: adresses.length };
  } catch (error) {
    return {
      mails: [],
      adresses: adresses.length,
      message: `Mails non lus : ${error instanceof Error ? error.message : 'erreur de messagerie'}`,
    };
  }
}
