import { and, asc, eq, gte, lte, ne } from 'drizzle-orm';
import { z } from 'zod';
import {
  creerRendezVousOs,
  enregistrerCompteRendu,
  lierRdv,
  RdvIndisponible,
} from '../conversion/rdv.js';
import type { ConnexionDeps } from '../connexions/service.js';
import { rendezVous } from '../crm/schema.js';
import type { Executor } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { reunionsWispr, sujets } from './schema.js';
import { marquerTraite, SujetRefuse, type SujetVue } from './service.js';

const JOUR_MS = 86_400_000;
// Un événement dans cette marge autour de la réunion est « le » rendez-vous attendu.
const PROCHE_MS = 3 * 3_600_000;

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
      .select({ debutAt: reunionsWispr.debutAt })
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
    const proches = lignes.filter(
      (r) =>
        r.debut && Math.abs(r.debut.getTime() - ref) <= PROCHE_MS && !r.eventId.startsWith('os:'),
    );
    const unique = proches.length === 1 ? proches[0]?.id : undefined;
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
  })
  .strict();

// Marc écrit le compte rendu depuis l'entrée d'Inbox : il va sur le rendez-vous (objet miroir de
// l'événement Google, ou créé dans l'OS), relié au contact et à l'entreprise de l'entrée, puis
// l'entrée est traitée. Refaire l'opération met à jour le même rendez-vous, sans doublon.
export async function enregistrerDepuisSujet(
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
    if (s.contactId) await lierRdv(db, instance, eventId, 'contact', s.contactId);
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
        versCerveau: false,
      },
      deps,
    );
  } catch (error) {
    if (error instanceof RdvIndisponible) throw new SujetRefuse(error.message);
    throw error;
  }
  return marquerTraite(db, instance, sujetId);
}
