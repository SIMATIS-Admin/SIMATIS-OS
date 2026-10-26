import { randomUUID } from 'node:crypto';
import { and, eq, gte, inArray, isNull, like, lt, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { zoned } from '../connecteurs/google/creneaux.js';
import {
  agendasDisponibles,
  evenements,
  type AgendaDisponible,
  type Evenement,
  type GoogleOptions,
} from '../connecteurs/google/google.js';
import { connexions } from '../connexions/schema.js';
import type { ConnexionDeps } from '../connexions/service.js';
import {
  activites,
  contacts,
  entreprises,
  opportunites,
  rdvAffaires,
  rdvContacts,
  rdvEntreprises,
  rendezVous,
  type Qualification,
} from '../crm/schema.js';
import type { Executor, Tx } from '../db.js';
import { contactsParEmails } from '../crm/emails.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { logEvent } from '../journal/service.js';
import { decaler, estCreneau, jourDe } from '../pilotage/realisees.js';
import '../pilotage/types-propositions.js';
import { propose, PropositionRefusee } from '../propositions/service.js';
import { loadInstanceSecrets } from '../secrets.js';

const FUSEAU = 'Europe/Paris';

// Qualification criteria (each scored 1 to 3). The questions to ask belong to the instance's
// private configuration (config.questions), never to this public repository.
const CRITERES: { id: keyof Qualification; nom: string }[] = [
  { id: 'besoin', nom: 'Besoin / enjeu' },
  { id: 'decideur', nom: 'Décideur / influence' },
  { id: 'budget', nom: 'Budget' },
  { id: 'timing', nom: 'Timing' },
  { id: 'engagement', nom: 'Engagement du prospect' },
];

type Questions = Partial<Record<keyof Qualification, string>>;

export class RdvIndisponible extends Error {}

// Past week and next two weeks of the instance's agenda, each meeting linked to the contact,
// company and open deal it concerns (by guest email), with its compte rendu status.
export async function listerRendezVous(
  db: Executor,
  instance: Instance,
  deps: ConnexionDeps,
  maintenant = new Date(),
  options: GoogleOptions = {},
) {
  const [agenda] = await withInstance(db, instance.id, (tx) =>
    tx
      .select({
        fournisseur: connexions.fournisseur,
        reglages: connexions.reglages,
        etat: connexions.etat,
      })
      .from(connexions)
      .where(and(eq(connexions.instanceId, currentInstance), eq(connexions.kind, 'agenda'))),
  );
  const jour = jourDe(maintenant, FUSEAU);
  const du = zoned(decaler(jour, -7), '00:00', FUSEAU);
  const au = zoned(decaler(jour, 15), '00:00', FUSEAU);
  // Meetings created in the OS need no Google: they show whatever happens to the agenda.
  const os = await rdvOs(db, instance, du);
  if (agenda?.fournisseur !== 'google-agenda' || agenda.etat === 'non_configuree') {
    return { etat: 'non_configure' as const, rdv: await relier(db, instance, os) };
  }
  const calendriers = Array.isArray(agenda.reglages.calendriers)
    ? (agenda.reglages.calendriers as string[])
    : ['primary'];
  const liste: Evenement[] = [];
  const ignores: string[] = [];
  let derniereErreur = '';
  try {
    const secrets = await loadInstanceSecrets(deps.secretsDir, instance.slug);
    for (const id of calendriers) {
      try {
        liste.push(...(await evenements({ instance, secrets }, du, au, [id], options)));
      } catch (error) {
        // An agenda that cannot be read (unknown id, access withdrawn) is left out: the others still show.
        ignores.push(id);
        derniereErreur = error instanceof Error ? error.message : String(error);
      }
    }
  } catch (error) {
    return {
      etat: 'erreur' as const,
      erreur: error instanceof Error ? error.message : String(error),
      rdv: await relier(db, instance, os),
    };
  }
  if (ignores.length === calendriers.length) {
    return { etat: 'erreur' as const, erreur: derniereErreur, rdv: await relier(db, instance, os) };
  }
  return {
    etat: 'ok' as const,
    // One read per agenda: put them back in time order.
    rdv: await relier(
      db,
      instance,
      // Slots of more than two hours are bookings, not meetings to prepare.
      [...liste.filter((e) => !estCreneau(e)), ...os].sort(
        (a, b) => a.debut.getTime() - b.debut.getTime(),
      ),
    ),
    agendasIgnores: ignores,
  };
}

// Meetings created in the OS (event id `os:…`), shaped like agenda events: from the start of the
// window on with no end (one planned in three months shows up as soon as it exists), and the older
// ones that still lack their compte rendu (to catch up). The Google calendar needs a window, these
// do not.
async function rdvOs(db: Executor, instance: Instance, du: Date): Promise<Evenement[]> {
  const lignes = await withInstance(db, instance.id, (tx) =>
    tx
      .select()
      .from(rendezVous)
      .where(
        and(
          eq(rendezVous.instanceId, currentInstance),
          like(rendezVous.eventId, 'os:%'),
          or(
            gte(rendezVous.debut, du),
            and(lt(rendezVous.debut, du), isNull(rendezVous.compteRendu)),
          ),
        ),
      ),
  );
  return lignes.flatMap((r) =>
    r.debut
      ? [
          {
            id: r.eventId,
            debut: r.debut,
            fin: r.fin ?? r.debut,
            titre: r.titre,
            lieu: r.lieu,
            participants: r.participants,
            journee: false,
            agenda: 'os',
            couleur: null,
            lien: null,
          },
        ]
      : [],
  );
}

export const rdvOsSchema = z
  .object({
    titre: z.string().trim().min(1).max(300),
    // Absurd years are typos: a meeting is within a few years of today.
    debut: z.iso
      .datetime()
      .refine((d) => d >= '2000-01-01' && d < '2100-01-01', 'Date hors limites'),
    dureeMinutes: z.number().int().min(5).max(1440).default(60),
    lieu: z.string().trim().max(300).nullish(),
  })
  .strict();

// A meeting that never was in Google: its id starts with `os:` so no agenda read can touch it.
export async function creerRendezVousOs(
  db: Executor,
  instance: Instance,
  saisie: z.infer<typeof rdvOsSchema>,
): Promise<string> {
  const debut = new Date(saisie.debut);
  const eventId = `os:${randomUUID()}`;
  await withInstance(db, instance.id, async (tx) => {
    await tx.insert(rendezVous).values({
      instanceId: currentInstance,
      eventId,
      titre: saisie.titre,
      debut,
      fin: new Date(debut.getTime() + saisie.dureeMinutes * 60_000),
      lieu: saisie.lieu || null,
      participants: [],
      statut: 'rdv',
    });
    await logEvent(tx, {
      acteur: 'pilote',
      action: 'Rendez-vous créé dans l’OS',
      niveau: 'L1',
      details: { eventId },
    });
  });
  return eventId;
}

// The calendars the instance's Google account can see, to choose which ones the agenda reads.
export async function listerAgendas(
  db: Executor,
  instance: Instance,
  deps: ConnexionDeps,
  options: GoogleOptions = {},
): Promise<
  | { etat: 'non_configure'; agendas: [] }
  | { etat: 'erreur'; erreur: string; agendas: [] }
  | { etat: 'ok'; agendas: AgendaDisponible[] }
> {
  const [agenda] = await withInstance(db, instance.id, (tx) =>
    tx
      .select({ fournisseur: connexions.fournisseur, etat: connexions.etat })
      .from(connexions)
      .where(and(eq(connexions.instanceId, currentInstance), eq(connexions.kind, 'agenda'))),
  );
  if (agenda?.fournisseur !== 'google-agenda' || agenda.etat === 'non_configuree') {
    return { etat: 'non_configure', agendas: [] };
  }
  try {
    const agendas = await agendasDisponibles(
      { instance, secrets: await loadInstanceSecrets(deps.secretsDir, instance.slug) },
      options,
    );
    return { etat: 'ok', agendas };
  } catch (error) {
    return {
      etat: 'erreur',
      erreur: error instanceof Error ? error.message : String(error),
      agendas: [],
    };
  }
}

export type StatutRdv = 'a_trier' | 'rdv' | 'ignore';
type Ref = { id: string; nom: string };

// Keeps a copy of the calendar blocks (title and times) so each one can be sorted, linked and
// opened later. The pilot's decision (statut) and links are never touched by the refresh.
async function memoriser(tx: Tx, liste: Evenement[]) {
  if (liste.length === 0) return [];
  const uniques = [...new Map(liste.map((e) => [e.id, e])).values()];
  return tx
    .insert(rendezVous)
    .values(
      uniques.map((e) => ({
        instanceId: currentInstance,
        eventId: e.id,
        titre: e.titre,
        debut: e.debut,
        fin: e.fin,
        lieu: e.lieu,
        participants: e.participants,
      })),
    )
    .onConflictDoUpdate({
      target: [rendezVous.instanceId, rendezVous.eventId],
      set: {
        titre: sql`excluded.titre`,
        debut: sql`excluded.debut`,
        fin: sql`excluded.fin`,
        lieu: sql`excluded.lieu`,
        participants: sql`excluded.participants`,
        updatedAt: new Date(),
      },
    })
    .returning({
      id: rendezVous.id,
      eventId: rendezVous.eventId,
      statut: rendezVous.statut,
      compteRendu: rendezVous.compteRendu,
    });
}

// What a meeting is linked to by hand, by meeting id.
async function liensDe(tx: Tx, rdvIds: string[]) {
  const vide = {
    contacts: new Map<string, Ref[]>(),
    entreprises: new Map<string, Ref[]>(),
    affaires: new Map<string, Ref[]>(),
  };
  if (rdvIds.length === 0) return vide;
  const ranger = (m: Map<string, Ref[]>, rdv: string, ref: Ref) =>
    m.set(rdv, [...(m.get(rdv) ?? []), ref]);
  for (const l of await tx
    .select({ rdv: rdvContacts.rendezVousId, id: contacts.id, nom: contacts.nom })
    .from(rdvContacts)
    .innerJoin(contacts, eq(contacts.id, rdvContacts.contactId))
    .where(
      and(eq(rdvContacts.instanceId, currentInstance), inArray(rdvContacts.rendezVousId, rdvIds)),
    )
    .orderBy(rdvContacts.createdAt))
    ranger(vide.contacts, l.rdv, { id: l.id, nom: l.nom });
  for (const l of await tx
    .select({ rdv: rdvEntreprises.rendezVousId, id: entreprises.id, nom: entreprises.nom })
    .from(rdvEntreprises)
    .innerJoin(entreprises, eq(entreprises.id, rdvEntreprises.entrepriseId))
    .where(
      and(
        eq(rdvEntreprises.instanceId, currentInstance),
        inArray(rdvEntreprises.rendezVousId, rdvIds),
      ),
    )
    .orderBy(rdvEntreprises.createdAt))
    ranger(vide.entreprises, l.rdv, { id: l.id, nom: l.nom });
  for (const l of await tx
    .select({ rdv: rdvAffaires.rendezVousId, id: opportunites.id, nom: opportunites.titre })
    .from(rdvAffaires)
    .innerJoin(opportunites, eq(opportunites.id, rdvAffaires.opportuniteId))
    .where(
      and(eq(rdvAffaires.instanceId, currentInstance), inArray(rdvAffaires.rendezVousId, rdvIds)),
    )
    .orderBy(rdvAffaires.createdAt))
    ranger(vide.affaires, l.rdv, { id: l.id, nom: l.nom });
  return vide;
}

async function relier(db: Executor, instance: Instance, liste: Evenement[]) {
  const emails = [...new Set(liste.flatMap((e) => e.participants))];
  return withInstance(db, instance.id, async (tx) => {
    const lignes = await memoriser(tx, liste);
    const manuels = await liensDe(
      tx,
      lignes.map((l) => l.id),
    );
    // Guests are matched on every address of a contact, not only its primary one.
    const parEmail = await contactsParEmails(tx, emails);
    const contactsChoisis = [
      ...new Set(
        [...manuels.contacts.values()]
          .flat()
          .map((c) => c.id)
          .concat([...parEmail.values()]),
      ),
    ];
    const lies = contactsChoisis.length
      ? await tx
          .select({
            id: contacts.id,
            nom: contacts.nom,
            email: contacts.email,
            entrepriseId: contacts.entrepriseId,
            entreprise: entreprises.nom,
          })
          .from(contacts)
          .leftJoin(
            entreprises,
            and(
              eq(entreprises.id, contacts.entrepriseId),
              eq(entreprises.instanceId, currentInstance),
            ),
          )
          .where(
            and(eq(contacts.instanceId, currentInstance), inArray(contacts.id, contactsChoisis)),
          )
      : [];
    const ouvertes =
      lignes.length > 0
        ? await tx
            .select({
              id: opportunites.id,
              titre: opportunites.titre,
              contactId: opportunites.contactId,
              entrepriseId: opportunites.entrepriseId,
            })
            .from(opportunites)
            .where(and(eq(opportunites.instanceId, currentInstance), isNull(opportunites.clos)))
        : [];
    const faits = liste.length
      ? await tx
          .select({ sourceId: activites.sourceId })
          .from(activites)
          .where(
            and(
              eq(activites.instanceId, currentInstance),
              eq(activites.source, 'rdv'),
              inArray(
                activites.sourceId,
                liste.map((e) => e.id),
              ),
            ),
          )
      : [];
    return liste.map((e) => {
      const ligne = lignes.find((l) => l.eventId === e.id);
      const rdvId = ligne?.id ?? '';
      const mContacts = manuels.contacts.get(rdvId) ?? [];
      const mEntreprises = manuels.entreprises.get(rdvId) ?? [];
      const mAffaires = manuels.affaires.get(rdvId) ?? [];
      // Linked by hand in the OS rather than through the guests' emails.
      const manuel = mContacts.length + mEntreprises.length + mAffaires.length > 0;
      const contact = manuel
        ? lies.find((c) => c.id === mContacts[0]?.id)
        : lies.find((c) => e.participants.some((p) => parEmail.get(p.toLowerCase()) === c.id));
      const entreprise =
        mEntreprises[0] ??
        (contact?.entrepriseId && contact.entreprise
          ? { id: contact.entrepriseId, nom: contact.entreprise }
          : undefined);
      const opp =
        (mAffaires[0] ? { id: mAffaires[0].id, titre: mAffaires[0].nom } : undefined) ??
        (contact && ouvertes.find((o) => o.contactId === contact.id)) ??
        (entreprise && ouvertes.find((o) => o.entrepriseId === entreprise.id));
      return {
        id: e.id,
        debut: e.debut,
        fin: e.fin,
        titre: e.titre,
        lieu: e.lieu,
        statut: (ligne?.statut ?? 'a_trier') as StatutRdv,
        contact: contact
          ? { id: contact.id, nom: contact.nom, entreprise: contact.entreprise }
          : null,
        entreprise: entreprise ?? null,
        lienManuel: manuel,
        opportunite: opp ? { id: opp.id, titre: opp.titre } : null,
        compteRendu: ligne?.compteRendu != null || faits.some((f) => f.sourceId === e.id),
      };
    });
  });
}

// Blocks of the agenda window still to sort, for the badge of the menu. Counted from the copies kept
// by the last read of the agenda, so the menu never waits for Google.
export async function compterATrier(db: Executor, instance: Instance, maintenant = new Date()) {
  const [r] = await withInstance(db, instance.id, (tx) =>
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(rendezVous)
      .where(
        and(
          eq(rendezVous.instanceId, currentInstance),
          eq(rendezVous.statut, 'a_trier'),
          gte(rendezVous.debut, new Date(maintenant.getTime() - 7 * 864e5)),
          lte(rendezVous.debut, new Date(maintenant.getTime() + 15 * 864e5)),
        ),
      ),
  );
  return r?.n ?? 0;
}

export class LienRdvInvalide extends Error {}

const cibles = {
  contact: { table: contacts, nom: 'Contact' },
  entreprise: { table: entreprises, nom: 'Entreprise' },
  affaire: { table: opportunites, nom: 'Affaire' },
} as const;
export type CibleRdv = keyof typeof cibles;

// The meeting's row, created on the spot when the calendar block was never listed (a link from the
// Agenda, a compte rendu): its title and times come with the next read of the agenda.
async function assurerRdv(tx: Tx, eventId: string) {
  // An `os:` id only exists once created: an invented one must not make a ghost meeting.
  if (eventId.startsWith('os:')) {
    const [existe] = await tx
      .select({ id: rendezVous.id })
      .from(rendezVous)
      .where(and(eq(rendezVous.instanceId, currentInstance), eq(rendezVous.eventId, eventId)));
    if (!existe) throw new RdvIndisponible('Rendez-vous introuvable');
    return existe.id;
  }
  const [row] = await tx
    .insert(rendezVous)
    .values({ instanceId: currentInstance, eventId })
    .onConflictDoUpdate({
      target: [rendezVous.instanceId, rendezVous.eventId],
      set: { updatedAt: new Date() },
    })
    .returning({ id: rendezVous.id });
  if (!row) throw new RdvIndisponible('Rendez-vous introuvable');
  return row.id;
}

async function verifierCible(tx: Tx, kind: CibleRdv, id: string) {
  const { table, nom } = cibles[kind];
  const [found] = await tx
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.instanceId, currentInstance), eq(table.id, id)));
  if (!found) throw new LienRdvInvalide(`${nom} introuvable dans cette instance`);
}

async function ajouterLien(tx: Tx, rdvId: string, kind: CibleRdv, id: string) {
  const base = { instanceId: currentInstance, rendezVousId: rdvId };
  if (kind === 'contact')
    await tx
      .insert(rdvContacts)
      .values({ ...base, contactId: id })
      .onConflictDoNothing();
  else if (kind === 'entreprise')
    await tx
      .insert(rdvEntreprises)
      .values({ ...base, entrepriseId: id })
      .onConflictDoNothing();
  else
    await tx
      .insert(rdvAffaires)
      .values({ ...base, opportuniteId: id })
      .onConflictDoNothing();
}

// Replaces the contact and company a meeting is linked to; both null removes the links (the
// guests' emails count again). Kept for the list screen's « Lier ».
export async function lierRendezVous(
  db: Executor,
  instance: Instance,
  eventId: string,
  lien: { contactId: string | null; entrepriseId: string | null },
) {
  return withInstance(db, instance.id, async (tx) => {
    if (lien.contactId) await verifierCible(tx, 'contact', lien.contactId);
    if (lien.entrepriseId) await verifierCible(tx, 'entreprise', lien.entrepriseId);
    const rdvId = await assurerRdv(tx, eventId);
    await tx
      .delete(rdvContacts)
      .where(and(eq(rdvContacts.instanceId, currentInstance), eq(rdvContacts.rendezVousId, rdvId)));
    await tx
      .delete(rdvEntreprises)
      .where(
        and(eq(rdvEntreprises.instanceId, currentInstance), eq(rdvEntreprises.rendezVousId, rdvId)),
      );
    if (lien.contactId) await ajouterLien(tx, rdvId, 'contact', lien.contactId);
    if (lien.entrepriseId) await ajouterLien(tx, rdvId, 'entreprise', lien.entrepriseId);
    await logEvent(tx, { acteur: 'pilote', action: 'Rendez-vous relié', niveau: 'L2' });
    return { ok: true };
  });
}

// Adds (or removes) one link of any kind to a meeting.
export async function lierRdv(
  db: Executor,
  instance: Instance,
  eventId: string,
  kind: CibleRdv,
  id: string,
  retirer = false,
) {
  return withInstance(db, instance.id, async (tx) => {
    const rdvId = await assurerRdv(tx, eventId);
    if (retirer) {
      const [table, colonne] =
        kind === 'contact'
          ? ([rdvContacts, rdvContacts.contactId] as const)
          : kind === 'entreprise'
            ? ([rdvEntreprises, rdvEntreprises.entrepriseId] as const)
            : ([rdvAffaires, rdvAffaires.opportuniteId] as const);
      await tx
        .delete(table)
        .where(
          and(
            eq(table.instanceId, currentInstance),
            eq(table.rendezVousId, rdvId),
            eq(colonne, id),
          ),
        );
    } else {
      await verifierCible(tx, kind, id);
      await ajouterLien(tx, rdvId, kind, id);
    }
    await logEvent(tx, { acteur: 'pilote', action: 'Rendez-vous relié', niveau: 'L2' });
    return { ok: true };
  });
}

// « Pas un RDV » (ignore) takes the block out of the lists for good; a_trier puts it back.
export async function decrireRdv(
  db: Executor,
  instance: Instance,
  eventId: string,
  statut: StatutRdv,
) {
  return withInstance(db, instance.id, async (tx) => {
    const rdvId = await assurerRdv(tx, eventId);
    await tx
      .update(rendezVous)
      .set({ statut, updatedAt: new Date() })
      .where(and(eq(rendezVous.instanceId, currentInstance), eq(rendezVous.id, rdvId)));
    await logEvent(tx, {
      acteur: 'pilote',
      action: statut === 'ignore' ? 'Rendez-vous écarté (pas un RDV)' : 'Rendez-vous trié',
      niveau: 'L1',
    });
    return { ok: true };
  });
}

// The meeting as a record: its links, its compte rendu, and the open tasks it gave rise to.
export async function getRendezVous(
  db: Executor,
  instance: Instance,
  eventId: string,
  deps: ConnexionDeps,
  options: GoogleOptions = {},
) {
  const lire = () =>
    withInstance(db, instance.id, async (tx) => {
      const [r] = await tx
        .select()
        .from(rendezVous)
        .where(and(eq(rendezVous.instanceId, currentInstance), eq(rendezVous.eventId, eventId)));
      if (!r) return null;
      const liens = await liensDe(tx, [r.id]);
      const contactsLies = (liens.contacts.get(r.id) ?? []).map((c) => c.id);
      const fonctions = contactsLies.length
        ? await tx
            .select({ id: contacts.id, fonction: contacts.fonction, entreprise: entreprises.nom })
            .from(contacts)
            .leftJoin(entreprises, eq(entreprises.id, contacts.entrepriseId))
            .where(
              and(eq(contacts.instanceId, currentInstance), inArray(contacts.id, contactsLies)),
            )
        : [];
      const parEmail = await contactsParEmails(tx, r.participants);
      const connus = parEmail.size
        ? await tx
            .select({ id: contacts.id, nom: contacts.nom, email: contacts.email })
            .from(contacts)
            .where(
              and(
                eq(contacts.instanceId, currentInstance),
                inArray(contacts.id, [...new Set(parEmail.values())]),
              ),
            )
        : [];
      return {
        id: r.eventId,
        titre: r.titre,
        debut: r.debut,
        fin: r.fin,
        lieu: r.lieu,
        statut: r.statut as StatutRdv,
        contacts: (liens.contacts.get(r.id) ?? []).map((c) => ({
          ...c,
          detail: fonctions.find((f) => f.id === c.id)?.entreprise ?? null,
        })),
        entreprises: liens.entreprises.get(r.id) ?? [],
        affaires: liens.affaires.get(r.id) ?? [],
        participants: r.participants.map((email) => ({
          email,
          contact: connus.find((c) => c.id === parEmail.get(email.toLowerCase())) ?? null,
        })),
        compteRendu: r.compteRendu ? { texte: r.compteRendu, at: r.compteRenduAt } : null,
      };
    });
  const trouve = await lire();
  if (trouve) return trouve;
  // An `os:` meeting is never in Google: no agenda read can find it.
  if (eventId.startsWith('os:')) throw new RdvIndisponible('Rendez-vous introuvable');
  // Never listed: one read of the agenda records it.
  await listerRendezVous(db, instance, deps, new Date(), options);
  const apres = await lire();
  if (!apres) throw new RdvIndisponible('Rendez-vous introuvable');
  return apres;
}

// What to look into before the meeting: the deal's qualification and the criteria still below 3.
export async function preparer(db: Executor, instance: Instance, opportuniteId: string) {
  return withInstance(db, instance.id, async (tx) => {
    const [o] = await tx
      .select({
        titre: opportunites.titre,
        qualification: opportunites.qualification,
        prochaineEtape: opportunites.prochaineEtape,
        entreprise: entreprises.nom,
        secteur: entreprises.secteur,
        ville: entreprises.ville,
        taille: entreprises.taille,
        contact: contacts.nom,
        fonction: contacts.fonction,
        role: contacts.role,
      })
      .from(opportunites)
      .leftJoin(
        entreprises,
        and(
          eq(entreprises.id, opportunites.entrepriseId),
          eq(entreprises.instanceId, currentInstance),
        ),
      )
      .leftJoin(
        contacts,
        and(eq(contacts.id, opportunites.contactId), eq(contacts.instanceId, currentInstance)),
      )
      .where(and(eq(opportunites.instanceId, currentInstance), eq(opportunites.id, opportuniteId)));
    if (!o) throw new RdvIndisponible('Opportunité introuvable dans cette instance');
    const questions = (instance.config as { questions?: Questions }).questions ?? {};
    const q = o.qualification;
    const score = q ? CRITERES.reduce((a, c) => a + q[c.id], 0) : null;
    return {
      ...o,
      score,
      aCreuser: CRITERES.filter((c) => !q || q[c.id] < 3).map((c) => ({
        critere: c.nom,
        note: q ? q[c.id] : null,
        question: questions[c.id] ?? null,
      })),
    };
  });
}

export const compteRenduSchema = z.object({
  titre: z.string().trim().min(1).max(300),
  texte: z.string().trim().min(1).max(10_000),
  contactId: z.uuid().nullish(),
  opportuniteId: z.uuid().nullish(),
  proposerTache: z.boolean().default(true),
  versCerveau: z.boolean().default(true),
});

// Saves the compte rendu on the meeting (and in the history of the records it is linked to), then
// proposes the next-step task and a draft note for the second brain, both for validation.
export async function enregistrerCompteRendu(
  db: Executor,
  instance: Instance,
  evenementId: string,
  input: z.input<typeof compteRenduSchema>,
  deps: ConnexionDeps,
) {
  const { proposerTache = true, versCerveau = true, ...cr } = input;
  return withInstance(db, instance.id, async (tx) => {
    const rdvId = await assurerRdv(tx, evenementId);
    const liens = await liensDe(tx, [rdvId]);
    const contactId = liens.contacts.get(rdvId)?.[0]?.id ?? cr.contactId ?? null;
    const entrepriseId = liens.entreprises.get(rdvId)?.[0]?.id ?? null;
    const opportuniteId = liens.affaires.get(rdvId)?.[0]?.id ?? cr.opportuniteId ?? null;
    const maintenant = new Date();
    await tx
      .update(rendezVous)
      .set({
        compteRendu: cr.texte,
        compteRenduAt: maintenant,
        // A meeting with a compte rendu is a meeting, whatever it was sorted as.
        statut: 'rdv',
        updatedAt: maintenant,
      })
      .where(and(eq(rendezVous.instanceId, currentInstance), eq(rendezVous.id, rdvId)));
    await tx
      .insert(activites)
      .values({
        instanceId: currentInstance,
        type: 'compte_rendu',
        source: 'rdv',
        sourceId: evenementId,
        contactId,
        entrepriseId,
        opportuniteId,
        titre: cr.titre,
        at: maintenant,
        resume: cr.texte,
      })
      .onConflictDoUpdate({
        target: [activites.instanceId, activites.source, activites.sourceId],
        set: {
          resume: cr.texte,
          titre: cr.titre,
          contactId,
          entrepriseId,
          opportuniteId,
          updatedAt: maintenant,
        },
      });
    await logEvent(tx, {
      acteur: 'pilote',
      action: `Compte rendu enregistré : ${cr.titre}`,
      niveau: 'L1',
    });
    const ctx = { instance, realWrites: deps.realWrites, secretsDir: deps.secretsDir };
    if (versCerveau) {
      // The compte rendu is saved whatever the autonomy says about the second brain.
      await propose(tx, ctx, {
        type: 'note.second_cerveau',
        auteur: 'os',
        contenu: {
          titre: `Compte rendu : ${cr.titre}`.slice(0, 300),
          texte: cr.texte,
          origine: 'Compte rendu de rendez-vous',
        },
      }).catch((error: unknown) => {
        if (!(error instanceof PropositionRefusee)) throw error;
      });
    }
    if (!proposerTache) return { ok: true };
    const echeance = new Date(Date.now() + 3 * 864e5).toISOString();
    return propose(tx, ctx, {
      type: 'crm.tache',
      auteur: 'os',
      contenu: {
        titre: `Prochaine étape après le rendez-vous : ${cr.titre}`.slice(0, 300),
        detail: cr.texte.slice(0, 5000),
        canal: 'tache',
        echeance,
        contactId,
        opportuniteId,
        origine: 'Compte rendu de rendez-vous',
      },
    });
  });
}
