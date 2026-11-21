import { and, asc, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm';
import { PROCHE_MS, plusProche } from '../conversion/reunion-rdv.js';
import { contactEmails, contacts, entreprises, rdvContacts, rendezVous } from '../crm/schema.js';
import type { Tx } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { SOURCE_RDV_LIBRE } from '../visio/enregistrement.js';
import type { DossierRdv } from './schema.js';

type Candidat = { eventId: string; titre: string; debut: string | null };

const interlocuteursLies = async (tx: Tx, rdvId: string): Promise<string[]> =>
  (
    await tx
      .select({ id: rdvContacts.contactId })
      .from(rdvContacts)
      .where(and(eq(rdvContacts.instanceId, currentInstance), eq(rdvContacts.rendezVousId, rdvId)))
      .orderBy(asc(rdvContacts.createdAt))
  ).map((l) => l.id);

// Les contacts dont une adresse (principale ou secondaire) est celle d'un invité, casse ignorée.
const contactsDesInvites = async (tx: Tx, participants: string[]): Promise<string[]> => {
  const adresses = [...new Set(participants.map((p) => p.trim().toLowerCase()).filter(Boolean))];
  if (adresses.length === 0) return [];
  const parPrincipal = await tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(
      and(
        eq(contacts.instanceId, currentInstance),
        inArray(sql`lower(${contacts.email})`, adresses),
      ),
    );
  const parSecondaire = await tx
    .select({ id: contactEmails.contactId })
    .from(contactEmails)
    .where(
      and(
        eq(contactEmails.instanceId, currentInstance),
        inArray(sql`lower(${contactEmails.email})`, adresses),
      ),
    );
  return [...new Set([...parPrincipal, ...parSecondaire].map((r) => r.id))];
};

// Le rendez-vous de l'agenda de la visio et les personnes de la fiche CRM, calculés sans IA.
// Certain = un seul candidat proche (règles de plusProche) ; sinon rien n'est pré-choisi et les
// candidats sont listés pour que Marc tranche. Une visio lancée depuis l'agenda est son propre rendez-vous.
export async function construireDossier(
  tx: Tx,
  a: { sessionVisioId: string; rdvId: string; debutAt: Date; participants: string[] },
): Promise<DossierRdv> {
  const [source] = await tx
    .select()
    .from(rendezVous)
    .where(and(eq(rendezVous.instanceId, currentInstance), eq(rendezVous.id, a.rdvId)));
  const vide: DossierRdv = {
    sessionVisioId: a.sessionVisioId,
    sourceRdvEventId: source?.eventId ?? '',
    rdv: null,
    rdvCertain: false,
    candidats: [],
    interlocuteurs: [],
  };
  if (!source) return vide;

  const vue = (r: { eventId: string; titre: string; debut: Date | null }): Candidat => ({
    eventId: r.eventId,
    titre: r.titre,
    debut: r.debut?.toISOString() ?? null,
  });
  let cible: { id: string; eventId: string; titre: string; debut: Date | null } | null = null;
  let candidats: Candidat[] = [];
  if (source.source !== SOURCE_RDV_LIBRE) {
    cible = source;
  } else {
    const proches = await tx
      .select()
      .from(rendezVous)
      .where(
        and(
          eq(rendezVous.instanceId, currentInstance),
          ne(rendezVous.id, source.id),
          ne(rendezVous.statut, 'ignore'),
          ne(rendezVous.source, SOURCE_RDV_LIBRE),
          sql`${rendezVous.eventId} not like 'os:%'`,
          gte(rendezVous.debut, new Date(a.debutAt.getTime() - PROCHE_MS)),
          lte(rendezVous.debut, new Date(a.debutAt.getTime() + PROCHE_MS)),
        ),
      )
      .orderBy(asc(rendezVous.debut));
    const choisi = plusProche(
      { debut: a.debutAt, participants: a.participants },
      proches.flatMap((r) =>
        r.debut ? [{ debut: r.debut, participants: r.participants, cible: r }] : [],
      ),
    );
    if (choisi) cible = choisi;
    else candidats = proches.map(vue);
  }

  const ids = [
    ...(cible ? await interlocuteursLies(tx, cible.id) : []),
    ...(await contactsDesInvites(tx, a.participants)),
  ];
  const uniques = [...new Set(ids)];
  const fiches = uniques.length
    ? await tx
        .select({ id: contacts.id, nom: contacts.nom, entreprise: entreprises.nom })
        .from(contacts)
        .leftJoin(
          entreprises,
          and(
            eq(entreprises.id, contacts.entrepriseId),
            eq(entreprises.instanceId, currentInstance),
          ),
        )
        .where(and(eq(contacts.instanceId, currentInstance), inArray(contacts.id, uniques)))
    : [];
  const interlocuteurs = uniques.flatMap((id, rang) => {
    const f = fiches.find((x) => x.id === id);
    return f
      ? [{ contactId: id, nom: f.nom, entreprise: f.entreprise, principal: rang === 0 }]
      : [];
  });
  if (interlocuteurs[0]) interlocuteurs[0].principal = true;

  return {
    ...vide,
    rdv: cible ? vue(cible) : null,
    rdvCertain: cible !== null,
    candidats,
    interlocuteurs,
  };
}
