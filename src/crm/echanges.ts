import { and, eq, inArray, max, sql } from 'drizzle-orm';
import { adressesDe, estReponseAuto, estRetourEnErreur } from '../base-vivante/boite-mail.js';
import type { Messagerie } from '../connecteurs/messagerie.js';
import type { ConnexionDeps } from '../connexions/service.js';
import type { Database } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { logEvent } from '../journal/service.js';
import type { Evenement } from './fiches.js';
import { boitesDeInstance, mailsEchanges } from './mails.js';
import { contactEchangesMail, contactEmails } from './schema.js';

// Where an open deal without a meeting stands in the mailbox: written to without an answer, or
// answered. A deal never written to has no ranking and stays in the Pipeline.
export type Classement = 'sans_reponse' | 'repondu';

export type ResumeEchanges = {
  envoyes: number;
  recus: number;
  dernierEnvoi: Date | null;
  dernierRecu: Date | null;
};

// A mail counts as an answer only when it comes from one of the contact's addresses (not from a
// third party who copied them), and is neither an automatic reply nor a bounce report.
export function resumerEchanges(mails: Evenement[], adresses: string[]): ResumeEchanges {
  const siennes = new Set(adresses.map((a) => a.trim().toLowerCase()));
  const r: ResumeEchanges = { envoyes: 0, recus: 0, dernierEnvoi: null, dernierRecu: null };
  for (const e of mails) {
    if (!e.mail) continue;
    const at = new Date(e.at);
    if (e.mail.sens === 'envoye') {
      r.envoyes++;
      if (!r.dernierEnvoi || at > r.dernierEnvoi) r.dernierEnvoi = at;
      continue;
    }
    const m = {
      id: e.id,
      labels: [],
      de: e.mail.de,
      a: e.mail.a,
      cc: e.mail.cc ?? null,
      objet: e.mail.objet,
      date: at,
      extrait: e.texte ?? '',
      autoSubmitted: null,
      autoreply: null,
      failedRecipients: null,
      precedence: null,
    };
    if (estRetourEnErreur(m) || estReponseAuto(m)) continue;
    if (!adressesDe(e.mail.de).some((a) => siennes.has(a))) continue;
    r.recus++;
    if (!r.dernierRecu || at > r.dernierRecu) r.dernierRecu = at;
  }
  return r;
}

// The contacts of the deal on the current row ("opportunites"): its linked contacts, its primary
// contact, and the people of its company (one of them may be the one who answered).
const contactsDeLAffaire = sql`(
  select x.contact_id from affaire_contacts x where x.opportunite_id = "opportunites"."id"
  union select "opportunites"."contact_id" where "opportunites"."contact_id" is not null
  union select c.id from contacts c
    where c.instance_id = "opportunites"."instance_id"
      and c.entreprise_id = "opportunites"."entreprise_id"
)`;

// Ranking of the deal on the current row, from what the mailbox said of its contacts.
export const classementAffaire = sql<Classement | null>`(case
  when exists (select 1 from contact_echanges_mail m
    where m.instance_id = "opportunites"."instance_id" and m.recus > 0
      and m.contact_id in ${contactsDeLAffaire}) then 'repondu'
  when exists (select 1 from contact_echanges_mail m
    where m.instance_id = "opportunites"."instance_id" and m.envoyes > 0
      and m.contact_id in ${contactsDeLAffaire}) then 'sans_reponse'
end)`;

// Contacts of the open deals without a commercial meeting: the only ones the mailbox is read for.
async function contactsALire(db: Database, instance: Instance): Promise<string[]> {
  return withInstance(db, instance.id, async (tx) => {
    const { rows } = await tx.execute<{ id: string }>(sql`
      select distinct c.id from opportunites
      join lateral ${contactsDeLAffaire} c(id) on true
      where opportunites.instance_id = ${currentInstance} and opportunites.clos is null
        and not exists (select 1 from rendez_vous r
          where r.instance_id = ${currentInstance} and r.statut = 'rdv' and (
            exists (select 1 from rdv_affaires x
              where x.rendez_vous_id = r.id and x.opportunite_id = opportunites.id)
            or exists (select 1 from rdv_contacts x
              where x.rendez_vous_id = r.id and x.contact_id = opportunites.contact_id)
            or exists (select 1 from rdv_entreprises x
              where x.rendez_vous_id = r.id and x.entreprise_id = opportunites.entreprise_id)))`);
    return rows.map((r) => r.id);
  });
}

// Reads the mailboxes for each of those contacts and keeps the counts. A contact whose mailbox
// could not be read keeps what an earlier pass found, rather than being reset to nothing.
export async function lireEchanges(
  db: Database,
  instance: Instance,
  deps: ConnexionDeps,
  boitesDe: (
    db: Database,
    i: Instance,
    d: ConnexionDeps,
  ) => Promise<Messagerie[]> = boitesDeInstance,
  maintenant = () => new Date(),
): Promise<{ contacts: number; erreurs: number }> {
  const boites = await boitesDe(db, instance, deps);
  if (!boites.length)
    throw new Error('Aucune messagerie connectée à cette instance (Paramètres > Connexions).');
  const ids = await contactsALire(db, instance);
  if (!ids.length) return { contacts: 0, erreurs: 0 };
  const adresses = await withInstance(db, instance.id, (tx) =>
    tx
      .select({ contactId: contactEmails.contactId, email: contactEmails.email })
      .from(contactEmails)
      .where(
        and(eq(contactEmails.instanceId, currentInstance), inArray(contactEmails.contactId, ids)),
      ),
  );
  let lus = 0;
  let erreurs = 0;
  for (const id of ids) {
    const siennes = [
      ...new Set(adresses.filter((a) => a.contactId === id).map((a) => a.email.toLowerCase())),
    ];
    if (!siennes.length) continue;
    const { mails, erreurs: e } = await mailsEchanges(boites, siennes);
    if (e.length) {
      erreurs++;
      continue;
    }
    const r = resumerEchanges(mails, siennes);
    const valeurs = { ...r, luLe: maintenant(), updatedAt: maintenant() };
    await withInstance(db, instance.id, (tx) =>
      tx
        .insert(contactEchangesMail)
        .values({ instanceId: instance.id, contactId: id, ...valeurs })
        .onConflictDoUpdate({
          target: [contactEchangesMail.instanceId, contactEchangesMail.contactId],
          set: valeurs,
        }),
    );
    lus++;
  }
  return { contacts: lus, erreurs };
}

export type EtatLecture = {
  etat: 'en_cours' | 'termine' | 'echec' | 'jamais';
  // Last time a contact's mails were read, whichever pass did it.
  derniereLecture: string | null;
  contacts?: number;
  erreur?: string;
};

// A pass a day is enough: the Pipeline and the Radar start one when the last is older than this.
const PERIME_MS = 6 * 3_600_000;
const jobs = new Map<string, Omit<EtatLecture, 'derniereLecture'>>();
// The pass each instance started last, so a test can wait for its end.
const enCours = new Map<string, Promise<void>>();
export const finDeLecture = (instanceId: string) => enCours.get(instanceId) ?? Promise.resolve();

async function derniereLecture(db: Database, instance: Instance): Promise<Date | null> {
  const [r] = await withInstance(db, instance.id, (tx) =>
    tx
      .select({ le: max(contactEchangesMail.luLe) })
      .from(contactEchangesMail)
      .where(eq(contactEchangesMail.instanceId, currentInstance)),
  );
  return r?.le ?? null;
}

export async function etatLecture(db: Database, instance: Instance): Promise<EtatLecture> {
  const job = jobs.get(instance.id) ?? { etat: 'jamais' as const };
  return { ...job, derniereLecture: (await derniereLecture(db, instance))?.toISOString() ?? null };
}

// Starts a pass in the background (one mailbox query per contact takes a while), unless one is
// running or, without `force`, the last one is recent. Read only on the mailbox and the CRM.
export async function lancerLecture(
  db: Database,
  instance: Instance,
  deps: ConnexionDeps,
  { force = false, boitesDe = boitesDeInstance, maintenant = new Date() } = {},
): Promise<EtatLecture & { lancee: boolean }> {
  const derniere = await derniereLecture(db, instance);
  const recente = derniere !== null && maintenant.getTime() - derniere.getTime() < PERIME_MS;
  // Read after the await: the Pipeline and the Radar opened together must not start two passes.
  const job = jobs.get(instance.id);
  // A failed pass is not retried on every page load, only on demand.
  if (job?.etat === 'en_cours' || (!force && (recente || job?.etat === 'echec')))
    return { ...(await etatLecture(db, instance)), lancee: false };
  const etat: Omit<EtatLecture, 'derniereLecture'> = { etat: 'en_cours' };
  jobs.set(instance.id, etat);
  const fin = lireEchanges(db, instance, deps, boitesDe).then(
    async (r) => {
      etat.etat = 'termine';
      etat.contacts = r.contacts;
      await withInstance(db, instance.id, (tx) =>
        logEvent(tx, {
          acteur: 'os',
          action: `Messagerie relue pour ${r.contacts} contact${r.contacts > 1 ? 's' : ''} du Pipeline sans rendez-vous${r.erreurs ? ` (${r.erreurs} non lu${r.erreurs > 1 ? 's' : ''})` : ''}`,
          niveau: 'L1',
        }),
      );
    },
    (error: unknown) => {
      etat.etat = 'echec';
      etat.erreur = error instanceof Error ? error.message : String(error);
    },
  );
  enCours.set(instance.id, fin);
  return { ...(await etatLecture(db, instance)), lancee: true };
}
