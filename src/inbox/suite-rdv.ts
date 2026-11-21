import { and, asc, eq, gte, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { ConnexionDeps } from '../connexions/service.js';
import { creerRendezVousOs, lierRdv } from '../conversion/rdv.js';
import { PROCHE_MS } from '../conversion/reunion-rdv.js';
import { contacts, rendezVous, taches } from '../crm/schema.js';
import { createTache } from '../crm/taches.js';
import type { Executor, Tx } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import { diagnosticProjets } from '../diagnostic/schema.js';
import { createProjet } from '../diagnostic/service.js';
import type { Instance } from '../instances/schema.js';
import type { DossierRdv, LigneSuite, SuiteAnnoncee } from './schema.js';
import { SujetRefuse } from './service.js';

// Ce que l'exécuteur rend après avoir lu la visio ; tout le reste est ignoré.
export const suiteAnnonceeSchema = z.object({
  diagnostic: z.object({ certain: z.boolean() }).optional(),
  rdv: z
    .object({
      titre: z.string().trim().min(1).max(300),
      // Claude donne un décalage horaire (« +01:00 ») : l'OS le ramène à l'heure UTC.
      debut: z.iso.datetime({ offset: true }).transform((d) => new Date(d).toISOString()),
      certain: z.boolean(),
    })
    .optional(),
  relance: z
    .object({
      titre: z.string().trim().min(1).max(300),
      echeance: z.iso.date(),
      certain: z.boolean(),
    })
    .optional(),
});

// Le diagnostic n'existe que dans l'espace SIMATIS (module « Outils et diagnostics »).
export const espaceDiagnostic = (instance: Instance) => instance.type === 'propre';

// Les lignes de suite d'une visio : l'OS vérifie ce qui existe déjà (agenda, diagnostics) pour ne
// rien proposer en double. Une ligne dite avec hésitation arrive décochée.
export async function construireSuite(
  tx: Tx,
  a: { instance: Instance; annoncee: SuiteAnnoncee; dossier: DossierRdv },
): Promise<LigneSuite[]> {
  const lignes: LigneSuite[] = [];
  const { annoncee, dossier } = a;
  const principal = dossier.interlocuteurs.find((i) => i.principal);

  if (annoncee.diagnostic && espaceDiagnostic(a.instance)) {
    const [fiche] = principal
      ? await tx
          .select({ entrepriseId: contacts.entrepriseId })
          .from(contacts)
          .where(
            and(eq(contacts.instanceId, currentInstance), eq(contacts.id, principal.contactId)),
          )
      : [];
    const [existant] =
      principal || fiche?.entrepriseId
        ? await tx
            .select({ id: diagnosticProjets.id, nom: diagnosticProjets.nom })
            .from(diagnosticProjets)
            .where(
              and(
                eq(diagnosticProjets.instanceId, currentInstance),
                or(
                  principal ? eq(diagnosticProjets.contactId, principal.contactId) : undefined,
                  fiche?.entrepriseId
                    ? eq(diagnosticProjets.entrepriseId, fiche.entrepriseId)
                    : undefined,
                ),
              ),
            )
            .limit(1)
        : [];
    lignes.push({
      genre: 'diagnostic',
      nom: `Diagnostic – ${principal?.entreprise ?? principal?.nom ?? 'à nommer'}`,
      coche: annoncee.diagnostic.certain && !existant,
      existant: existant ?? null,
    });
  }

  if (annoncee.rdv) {
    const centre = new Date(annoncee.rdv.debut).getTime();
    const [deja] = await tx
      .select({ eventId: rendezVous.eventId, titre: rendezVous.titre, debut: rendezVous.debut })
      .from(rendezVous)
      .where(
        and(
          eq(rendezVous.instanceId, currentInstance),
          ne(rendezVous.statut, 'ignore'),
          ne(rendezVous.eventId, dossier.sourceRdvEventId),
          gte(rendezVous.debut, new Date(centre - PROCHE_MS)),
          lte(rendezVous.debut, new Date(centre + PROCHE_MS)),
        ),
      )
      .orderBy(asc(sql`abs(extract(epoch from ${rendezVous.debut}) - ${centre / 1000})`))
      .limit(1);
    lignes.push({
      genre: 'rdv',
      titre: annoncee.rdv.titre,
      debut: annoncee.rdv.debut,
      coche: annoncee.rdv.certain && !deja,
      dejaAgenda: deja ? { ...deja, debut: deja.debut?.toISOString() ?? null } : null,
    });
  }

  if (annoncee.relance) {
    lignes.push({
      genre: 'relance',
      titre: annoncee.relance.titre,
      echeance: annoncee.relance.echeance,
      coche: annoncee.relance.certain,
    });
  }
  return lignes;
}

// Les lignes que Marc a laissées cochées à l'acquittement, avec les textes qu'il a pu corriger.
export const suiteAcquittementSchema = z
  .object({
    diagnostic: z
      .object({ nom: z.string().trim().min(1).max(200) })
      .strict()
      .optional(),
    rdv: z
      .object({ titre: z.string().trim().min(1).max(300), debut: z.iso.datetime() })
      .strict()
      .optional(),
    relance: z
      .object({ titre: z.string().trim().min(1).max(300), echeance: z.iso.date() })
      .strict()
      .optional(),
  })
  .strict();
export type SuiteAcquittement = z.infer<typeof suiteAcquittementSchema>;

// À vérifier avant toute écriture : un acquittement refusé ne doit rien avoir créé.
export function verifierSuite(instance: Instance, suite: SuiteAcquittement | undefined): void {
  if (suite?.diagnostic && !espaceDiagnostic(instance))
    throw new SujetRefuse('Le diagnostic est réservé à l’espace SIMATIS.');
}

// Chaque création vérifie d'abord ce qui existe : l'acquittement n'est pas une seule transaction, et
// Marc peut le relancer après une interruption sans obtenir de doublon.
export async function appliquerSuite(
  db: Executor,
  instance: Instance,
  suite: SuiteAcquittement,
  cible: {
    contactId: string | null;
    entrepriseId: string | null;
    opportuniteId: string | null;
  },
  deps: ConnexionDeps,
): Promise<void> {
  const { contactId, entrepriseId, opportuniteId } = cible;
  if (suite.diagnostic) {
    const nom = suite.diagnostic.nom;
    const [deja] = await withInstance(db, instance.id, (tx) =>
      tx
        .select({ id: diagnosticProjets.id })
        .from(diagnosticProjets)
        .where(
          and(eq(diagnosticProjets.instanceId, currentInstance), eq(diagnosticProjets.nom, nom)),
        )
        .limit(1),
    );
    if (!deja)
      await createProjet(db, instance, {
        nom,
        activite: 'autre',
        entrepriseId,
        contactId,
        opportuniteId,
      });
  }
  if (suite.rdv) {
    const { titre, debut } = suite.rdv;
    const [deja] = await withInstance(db, instance.id, (tx) =>
      tx
        .select({ eventId: rendezVous.eventId })
        .from(rendezVous)
        .where(
          and(
            eq(rendezVous.instanceId, currentInstance),
            eq(rendezVous.titre, titre),
            eq(rendezVous.debut, new Date(debut)),
            sql`${rendezVous.eventId} like 'os:%'`,
          ),
        )
        .limit(1),
    );
    const eventId =
      deja?.eventId ??
      (await creerRendezVousOs(db, instance, { titre, debut, dureeMinutes: 60 })).id;
    if (contactId) await lierRdv(db, instance, eventId, 'contact', contactId);
    if (entrepriseId) await lierRdv(db, instance, eventId, 'entreprise', entrepriseId);
  }
  if (suite.relance) {
    const { titre, echeance } = suite.relance;
    // Jour de l'échéance, en milieu de matinée UTC : la même date à Paris, hiver comme été.
    const quand = `${echeance}T09:00:00.000Z`;
    const [deja] = await withInstance(db, instance.id, (tx) =>
      tx
        .select({ id: taches.id })
        .from(taches)
        .where(
          and(
            eq(taches.instanceId, currentInstance),
            eq(taches.titre, titre),
            eq(taches.echeance, new Date(quand)),
            isNull(taches.faitAt),
          ),
        )
        .limit(1),
    );
    if (!deja)
      await createTache(
        db,
        instance,
        { titre, echeance: quand, contactId, entrepriseId, opportuniteId },
        deps,
      );
  }
}
