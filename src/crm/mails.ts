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

// The instance's mailboxes: the connected one, plus the second one (read only) when Gmail has it.
async function boitesDeInstance(db: Database, instance: Instance, deps: ConnexionDeps) {
  const [c] = await withInstance(db, instance.id, (tx) =>
    tx
      .select({ fournisseur: connexions.fournisseur, etat: connexions.etat })
      .from(connexions)
      .where(and(eq(connexions.instanceId, currentInstance), eq(connexions.kind, 'messagerie'))),
  );
  if (!c || c.etat === 'non_configuree' || !['gmail', 'infomaniak'].includes(c.fournisseur))
    return [];
  const secrets = await loadInstanceSecrets(deps.secretsDir, instance.slug);
  const boites = [messagerieDe(c.fournisseur, { instance, secrets })];
  const seconde = secrets.GOOGLE_LECTURE2_REFRESH_TOKEN;
  if (c.fournisseur === 'gmail' && seconde)
    boites.push(
      messagerieDe('gmail', {
        instance,
        secrets: { ...secrets, GOOGLE_REFRESH_TOKEN: seconde },
      }),
    );
  return boites;
}

// Sent and received mails of the addresses, newest first, one line per message. A mailbox that
// fails does not hide the others: its error comes back beside what the others read.
export async function mailsEchanges(
  boites: Messagerie[],
  adresses: string[],
): Promise<{ mails: Evenement[]; erreurs: string[] }> {
  const vus = new Map<string, Evenement>();
  const erreurs: string[] = [];
  for (const boite of boites) {
    try {
      const compte = (await boite.compte()).toLowerCase();
      for (const adresse of adresses) {
        for (const m of await boite.historique(adresse, { mois: MOIS, max: PAR_ADRESSE })) {
          const at = m.date ? new Date(m.date) : null;
          // The same mail sits in both boxes when both are on it: one line, the first box's.
          const cle = `${m.id}@${compte}`;
          if (!at || Number.isNaN(at.getTime()) || vus.has(cle)) continue;
          const envoye = compte !== '' && (m.de ?? '').toLowerCase().includes(compte);
          vus.set(cle, {
            id: `mail-${compte}-${m.id}`,
            type: 'email',
            titre: `${envoye ? 'Envoyé' : 'Reçu'} · ${m.objet?.trim() || '(sans objet)'}`,
            texte: m.extrait || null,
            at: at.toISOString(),
            origine: 'os',
            ...(boites.length > 1 && compte ? { compte } : {}),
          });
        }
      }
    } catch (error) {
      erreurs.push(error instanceof Error ? error.message : 'erreur de messagerie');
    }
  }
  return { mails: [...vus.values()].sort((x, y) => y.at.localeCompare(x.at)), erreurs };
}

export async function mailsDeFiche(
  db: Database,
  instance: Instance,
  kind: Kind,
  id: string,
  deps: ConnexionDeps,
  boitesDe: (
    db: Database,
    i: Instance,
    d: ConnexionDeps,
  ) => Promise<Messagerie[]> = boitesDeInstance,
): Promise<MailsFiche> {
  const adresses = await adressesDeFiche(db, instance, kind, id);
  if (!adresses.length)
    return { mails: [], adresses: 0, message: 'Aucune adresse email sur cette fiche.' };
  const boites = await boitesDe(db, instance, deps);
  if (!boites.length)
    return {
      mails: [],
      adresses: adresses.length,
      message: 'Aucune messagerie connectée à cette instance (Paramètres > Connexions).',
    };
  const { mails, erreurs } = await mailsEchanges(boites, adresses);
  return {
    mails,
    adresses: adresses.length,
    ...(erreurs.length ? { message: `Mails non lus : ${erreurs.join(' ; ')}` } : {}),
  };
}
