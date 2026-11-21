import { and, asc, eq, gte, inArray, lte, ne } from 'drizzle-orm';
import { z } from 'zod';
import {
  creerRendezVousOs,
  enregistrerCompteRendu,
  lierRdv,
  RdvIndisponible,
} from '../conversion/rdv.js';
import type { ConnexionDeps } from '../connexions/service.js';
import { contacts, rendezVous } from '../crm/schema.js';
import type { Executor } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { plusProche } from '../conversion/reunion-rdv.js';
import { FusionImpossible, fusionnerSession } from '../visio/enregistrement.js';
import { reunionsWispr, sujets } from './schema.js';
import { marquerTraite, SujetRefuse, type SujetVue } from './service.js';
import { appliquerSuite, suiteAcquittementSchema, verifierSuite } from './suite-rdv.js';

const JOUR_MS = 86_400_000;

export type CandidatRdv = {
  eventId: string;
  titre: string;
  debut: string | null;
  compteRendu: boolean;
  // Un seul événement proche de la réunion : l'écran le pré-sélectionne.
  propose: boolean;
};

// Les événements d'agenda déjà connus de l'OS autour de la date de l'entrée : celle de la réunion
// Wispr Flow, sinon celle d'arrivée de l'entrée. Ceux écartés (« pas un RDV ») ne reviennent pas.
export async function candidatsRendezVous(
  db: Executor,
  instance: Instance,
  sujetId: string,
): Promise<CandidatRdv[] | null> {
  return withInstance(db, instance.id, async (tx) => {
    const [s] = await tx
      .select()
      .from(sujets)
      .where(and(eq(sujets.instanceId, currentInstance), eq(sujets.id, sujetId)));
    if (!s) return null;
    const [reunion] = await tx
      .select({ debutAt: reunionsWispr.debutAt, participants: reunionsWispr.participants })
      .from(reunionsWispr)
      .where(and(eq(reunionsWispr.instanceId, currentInstance), eq(reunionsWispr.sujetId, s.id)));
    const ref = (reunion?.debutAt ?? s.createdAt).getTime();
    const lignes = await tx
      .select()
      .from(rendezVous)
      .where(
        and(
          eq(rendezVous.instanceId, currentInstance),
          ne(rendezVous.statut, 'ignore'),
          gte(rendezVous.debut, new Date(ref - 14 * JOUR_MS)),
          lte(rendezVous.debut, new Date(ref + JOUR_MS)),
        ),
      )
      .orderBy(asc(rendezVous.debut));
    // Le rendez-vous attendu : le seul proche, sinon celui qui partage un invité avec la réunion.
    const unique = plusProche(
      { debut: new Date(ref), participants: reunion?.participants ?? [] },
      lignes.flatMap((r) =>
        r.debut && !r.eventId.startsWith('os:')
          ? [{ debut: r.debut, participants: r.participants, cible: r.id }]
          : [],
      ),
    );
    return lignes
      .map((r) => ({
        eventId: r.eventId,
        titre: r.titre,
        debut: r.debut?.toISOString() ?? null,
        compteRendu: !!r.compteRendu,
        propose: r.id === unique,
      }))
      .sort((a, b) => Date.parse(b.debut ?? '') - Date.parse(a.debut ?? ''));
  });
}

export const compteRenduSujetSchema = z
  .object({
    // Un événement déjà connu, ou rien : le rendez-vous est alors créé dans l'OS (sans Google).
    eventId: z.string().min(1).max(300).optional(),
    titre: z.string().trim().min(1).max(300).optional(),
    debut: z.iso.datetime().optional(),
    texte: z.string().trim().min(1).max(10_000),
    opportuniteId: z.uuid().nullish(),
    // Interlocuteur choisi par le pilote (sinon celui de l'entrée) ; note du second cerveau cochée ou non.
    contactId: z.uuid().nullish(),
    cerveau: z.boolean().optional(),
    // Lignes de suite laissées cochées (livraison 2) : diagnostic, rendez-vous, relance.
    suite: suiteAcquittementSchema.optional(),
  })
  .strict();

// Marc écrit le compte rendu depuis l'entrée d'Inbox : il va sur le rendez-vous (objet miroir de
// l'événement Google, ou créé dans l'OS), relié au contact et à l'entreprise de l'entrée, puis
// l'entrée est traitée. Refaire l'opération met à jour le même rendez-vous, sans doublon.
// Un double clic ne doit pas créer deux rendez-vous : les acquittements d'une même entrée passent
// l'un après l'autre (un seul processus serveur), le second trouve l'entrée déjà traitée.
const enCours = new Map<string, Promise<unknown>>();
async function enSerie<T>(cle: string, travail: () => Promise<T>): Promise<T> {
  const precedent = enCours.get(cle) ?? Promise.resolve();
  const suite = precedent.then(travail, travail);
  const fin = suite.catch(() => undefined);
  enCours.set(cle, fin);
  try {
    return await suite;
  } finally {
    if (enCours.get(cle) === fin) enCours.delete(cle);
  }
}

export const enregistrerDepuisSujet = (
  db: Executor,
  instance: Instance,
  sujetId: string,
  input: z.infer<typeof compteRenduSujetSchema>,
  deps: ConnexionDeps,
): Promise<SujetVue | null> =>
  enSerie(`${instance.id}:${sujetId}`, () => acquitterSujet(db, instance, sujetId, input, deps));

async function acquitterSujet(
  db: Executor,
  instance: Instance,
  sujetId: string,
  input: z.infer<typeof compteRenduSujetSchema>,
  deps: ConnexionDeps,
): Promise<SujetVue | null> {
  const s = await withInstance(db, instance.id, async (tx) => {
    const [row] = await tx
      .select()
      .from(sujets)
      .where(and(eq(sujets.instanceId, currentInstance), eq(sujets.id, sujetId)));
    return row;
  });
  if (!s) return null;
  if (s.type !== 'compte_rendu') throw new SujetRefuse('Cette entrée n’est pas un compte rendu.');
  if (s.statut !== 'a_traiter') throw new SujetRefuse('Sujet déjà traité.');

  // Une entrée avec dossier : l'interlocuteur est celui que Marc a choisi à l'écran (null = personne),
  // jamais celui de l'OS en plus. Sans dossier, comportement d'avant.
  const dossier = s.compteRenduPrepare?.dossier;
  const contactIds = dossier
    ? input.contactId
      ? [input.contactId]
      : []
    : [...new Set([s.contactId, input.contactId].filter((c): c is string => !!c))];
  if (contactIds.length > 0) {
    // Avant de créer quoi que ce soit : un contact disparu ne doit pas laisser un rendez-vous orphelin.
    const trouves = await withInstance(db, instance.id, (tx) =>
      tx
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.instanceId, currentInstance), inArray(contacts.id, contactIds))),
    );
    if (trouves.length !== contactIds.length) throw new SujetRefuse('Interlocuteur introuvable.');
  }

  verifierSuite(instance, input.suite);

  let eventId = input.eventId;
  if (!eventId) {
    const debut = input.debut ?? s.createdAt.toISOString();
    ({ id: eventId } = await creerRendezVousOs(db, instance, {
      titre: input.titre ?? s.titre.replace(/^Compte rendu\s*:\s*/i, ''),
      debut,
      dureeMinutes: 60,
    }));
  }
  const titre = input.titre ?? s.titre;
  try {
    for (const contactId of contactIds) await lierRdv(db, instance, eventId, 'contact', contactId);
    if (s.entrepriseId) await lierRdv(db, instance, eventId, 'entreprise', s.entrepriseId);
    await enregistrerCompteRendu(
      db,
      instance,
      eventId,
      {
        titre,
        texte: input.texte,
        opportuniteId: input.opportuniteId ?? null,
        proposerTache: false,
        versCerveau: input.cerveau ?? false,
      },
      deps,
      { accorde: true },
    );
  } catch (error) {
    if (error instanceof RdvIndisponible) throw new SujetRefuse(error.message);
    throw error;
  }
  if (input.suite) {
    const lien = contactIds[0] ?? null;
    const [fiche] = lien
      ? await withInstance(db, instance.id, (tx) =>
          tx
            .select({ entrepriseId: contacts.entrepriseId })
            .from(contacts)
            .where(and(eq(contacts.instanceId, currentInstance), eq(contacts.id, lien))),
        )
      : [];
    await appliquerSuite(
      db,
      instance,
      input.suite,
      {
        contactId: lien,
        entrepriseId: s.entrepriseId ?? fiche?.entrepriseId ?? null,
        opportuniteId: input.opportuniteId ?? null,
      },
      deps,
    );
  }
  const traitee = await marquerTraite(db, instance, sujetId);
  // Une réunion, une entrée : celle que l'agenda a déposée pour le rendez-vous retenu est traitée aussi.
  const doublon = await withInstance(db, instance.id, async (tx) => {
    const [d] = await tx
      .select({ id: sujets.id })
      .from(sujets)
      .where(
        and(
          eq(sujets.instanceId, currentInstance),
          eq(sujets.type, 'compte_rendu'),
          eq(sujets.statut, 'a_traiter'),
          eq(sujets.sourceId, `agenda:${eventId}`),
          ne(sujets.id, sujetId),
        ),
      );
    return d;
  });
  if (doublon) await marquerTraite(db, instance, doublon.id);
  // La visio enregistrée hors agenda rejoint le rendez-vous retenu (son texte y passe). Après le
  // traitement de l'entrée : la fusion range le résumé et peut retirer les entrées de la visio.
  // Elle ne bloque jamais l'acquittement.
  if (dossier?.sessionVisioId && dossier.sourceRdvEventId !== eventId) {
    await withInstance(db, instance.id, (tx) =>
      fusionnerSession(tx, dossier.sessionVisioId, eventId),
    ).catch((error: unknown) => {
      if (!(error instanceof FusionImpossible)) throw error;
    });
  }
  return traitee;
}
