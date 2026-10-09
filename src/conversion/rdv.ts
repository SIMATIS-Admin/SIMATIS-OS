import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { zoned } from '../connecteurs/google/creneaux.js';
import { evenements, type Evenement, type GoogleOptions } from '../connecteurs/google/google.js';
import { connexions } from '../connexions/schema.js';
import type { ConnexionDeps } from '../connexions/service.js';
import {
  activites,
  contacts,
  entreprises,
  opportunites,
  type Qualification,
} from '../crm/schema.js';
import type { Executor } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { logEvent } from '../journal/service.js';
import { decaler, jourDe } from '../pilotage/realisees.js';
import '../pilotage/types-propositions.js';
import { propose } from '../propositions/service.js';
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
  if (agenda?.fournisseur !== 'google-agenda' || agenda.etat === 'non_configuree') {
    return { etat: 'non_configure' as const, rdv: [] };
  }
  const jour = jourDe(maintenant, FUSEAU);
  let liste: Evenement[];
  try {
    const calendriers = Array.isArray(agenda.reglages.calendriers)
      ? (agenda.reglages.calendriers as string[])
      : ['primary'];
    liste = await evenements(
      { instance, secrets: await loadInstanceSecrets(deps.secretsDir, instance.slug) },
      zoned(decaler(jour, -7), '00:00', FUSEAU),
      zoned(decaler(jour, 15), '00:00', FUSEAU),
      calendriers,
      options,
    );
  } catch (error) {
    return {
      etat: 'erreur' as const,
      erreur: error instanceof Error ? error.message : String(error),
      rdv: [],
    };
  }
  return { etat: 'ok' as const, rdv: await relier(db, instance, liste) };
}

async function relier(db: Executor, instance: Instance, liste: Evenement[]) {
  const emails = [...new Set(liste.flatMap((e) => e.participants))];
  return withInstance(db, instance.id, async (tx) => {
    const lies = emails.length
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
            and(
              eq(contacts.instanceId, currentInstance),
              inArray(sql`lower(${contacts.email})`, emails),
            ),
          )
      : [];
    const ouvertes = lies.length
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
      const contact = lies.find((c) => c.email && e.participants.includes(c.email.toLowerCase()));
      const opp = contact
        ? (ouvertes.find((o) => o.contactId === contact.id) ??
          ouvertes.find((o) => contact.entrepriseId && o.entrepriseId === contact.entrepriseId))
        : undefined;
      return {
        id: e.id,
        debut: e.debut,
        fin: e.fin,
        titre: e.titre,
        lieu: e.lieu,
        contact: contact
          ? { id: contact.id, nom: contact.nom, entreprise: contact.entreprise }
          : null,
        opportunite: opp ? { id: opp.id, titre: opp.titre } : null,
        compteRendu: faits.some((f) => f.sourceId === e.id),
      };
    });
  });
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
});

// Saves the compte rendu, then proposes the next-step task for validation.
export async function enregistrerCompteRendu(
  db: Executor,
  instance: Instance,
  evenementId: string,
  input: z.infer<typeof compteRenduSchema>,
  deps: ConnexionDeps,
) {
  return withInstance(db, instance.id, async (tx) => {
    await tx
      .insert(activites)
      .values({
        instanceId: currentInstance,
        type: 'compte_rendu',
        source: 'rdv',
        sourceId: evenementId,
        contactId: input.contactId ?? null,
        at: new Date(),
        resume: input.texte,
      })
      .onConflictDoUpdate({
        target: [activites.instanceId, activites.source, activites.sourceId],
        set: { resume: input.texte, updatedAt: new Date() },
      });
    await logEvent(tx, {
      acteur: 'pilote',
      action: `Compte rendu enregistré : ${input.titre}`,
      niveau: 'L1',
    });
    const echeance = new Date(Date.now() + 3 * 864e5).toISOString();
    return propose(
      tx,
      { instance, realWrites: deps.realWrites, secretsDir: deps.secretsDir },
      {
        type: 'crm.tache',
        auteur: 'os',
        contenu: {
          titre: `Prochaine étape après le rendez-vous : ${input.titre}`.slice(0, 300),
          detail: input.texte.slice(0, 5000),
          canal: 'tache',
          echeance,
          contactId: input.contactId ?? null,
          opportuniteId: input.opportuniteId ?? null,
          origine: 'Compte rendu de rendez-vous',
        },
      },
    );
  });
}
