import { and, desc, eq, isNotNull, ne } from 'drizzle-orm';
import type { Executor, Tx } from '../db.js';
import { withInstance } from '../db/context.js';
import { rdvEntreprises, rendezVous } from '../crm/schema.js';
import type { Instance } from '../instances/schema.js';
import { ChatIndisponible, envoyerMessage } from './chat.js';
import { diagnosticProjets } from './schema.js';
import { ProjetIntrouvable, verifierEspace, type ProjetVue } from './service.js';
import { SupportInvalide } from './support.js';

// Capitalisation de la restitution (étape 5) : le pilote choisit le rendez-vous dont il a écrit le
// compte rendu, Claude propose ce qu'il en retient pour le second cerveau (temps 1, sans rien
// écrire), puis l'écrit une fois le pilote d'accord (temps 2).
export const DEBUT_MESSAGE_PROPOSITION = 'Capitaliser la restitution';
export const DEBUT_MESSAGE_ENREGISTREMENT = 'Enregistrer la capitalisation dans le second cerveau';

export type RdvCapitalisable = {
  id: string;
  titre: string;
  debut: Date | null;
  compteRenduAt: Date;
};

// Rendez-vous reliés à l'entreprise du projet qui ont un compte rendu, du plus récent au plus ancien.
async function liste(tx: Tx, instanceId: string, id: string): Promise<RdvCapitalisable[]> {
  const [projet] = await tx
    .select({ entrepriseId: diagnosticProjets.entrepriseId })
    .from(diagnosticProjets)
    .where(and(eq(diagnosticProjets.id, id), eq(diagnosticProjets.instanceId, instanceId)));
  if (!projet) throw new ProjetIntrouvable('Projet introuvable dans cette instance');
  if (!projet.entrepriseId) return [];
  const rows = await tx
    .select({
      id: rendezVous.id,
      titre: rendezVous.titre,
      debut: rendezVous.debut,
      compteRendu: rendezVous.compteRendu,
      compteRenduAt: rendezVous.compteRenduAt,
    })
    .from(rdvEntreprises)
    .innerJoin(rendezVous, eq(rendezVous.id, rdvEntreprises.rendezVousId))
    .where(
      and(
        eq(rdvEntreprises.instanceId, instanceId),
        eq(rdvEntreprises.entrepriseId, projet.entrepriseId),
        isNotNull(rendezVous.compteRendu),
        ne(rendezVous.statut, 'ignore'),
      ),
    )
    .orderBy(desc(rendezVous.debut));
  return rows
    .filter((r) => r.compteRendu?.trim() && r.compteRenduAt)
    .map((r) => ({ id: r.id, titre: r.titre, debut: r.debut, compteRenduAt: r.compteRenduAt! }));
}

export async function rendezVousCapitalisables(
  db: Executor,
  instance: Instance,
  id: string,
): Promise<RdvCapitalisable[]> {
  verifierEspace(instance);
  return withInstance(db, instance.id, (tx) => liste(tx, instance.id, id));
}

export async function demanderProposition(
  db: Executor,
  instance: Instance,
  id: string,
  rdvId: string,
): Promise<ProjetVue> {
  const choisi = (await rendezVousCapitalisables(db, instance, id)).find((r) => r.id === rdvId);
  if (!choisi)
    throw new ChatIndisponible(
      "Ce rendez-vous n'a pas de compte rendu pour l'entreprise du projet.",
    );
  return envoyerMessage(db, instance, id, `${DEBUT_MESSAGE_PROPOSITION}.`, {
    type: 'capitalisation_proposer',
    etape: 5,
    maj: { capitalisationStatut: 'en_cours', capitalisationRdvId: rdvId },
    verifier: (projet) => {
      if (projet.etape < 5) throw new ChatIndisponible('La capitalisation se lance à l’étape 5.');
      if (projet.capitalisationStatut === 'en_cours')
        throw new ChatIndisponible('Une capitalisation est déjà en cours pour ce projet.');
      if (
        projet.capitalisationStatut === 'enregistre' &&
        projet.capitalisationRdvId === rdvId &&
        projet.capitalisationCompteRenduAt?.getTime() === choisi.compteRenduAt.getTime()
      )
        throw new ChatIndisponible('Ce compte rendu est déjà capitalisé.');
    },
  });
}

export function demanderEnregistrement(
  db: Executor,
  instance: Instance,
  id: string,
): Promise<ProjetVue> {
  return envoyerMessage(db, instance, id, `${DEBUT_MESSAGE_ENREGISTREMENT}.`, {
    type: 'capitalisation_enregistrer',
    etape: 5,
    verifier: (projet) => {
      if (projet.capitalisationStatut !== 'propose')
        throw new ChatIndisponible("Demandez d'abord la proposition de capitalisation.");
    },
  });
}

// Claude a écrit dans le second cerveau (outil enregistrer_capitalisation) : on garde la date du
// compte rendu capitalisé, pour ne pas le refaire tant qu'il n'a pas changé.
export async function enregistrerCapitalisation(tx: Tx, id: string): Promise<void> {
  const [projet] = await tx.select().from(diagnosticProjets).where(eq(diagnosticProjets.id, id));
  if (!projet) throw new ProjetIntrouvable('Projet introuvable dans cette instance');
  if (projet.demande !== 'capitalisation_enregistrer')
    throw new SupportInvalide("Le pilote n'a pas demandé d'enregistrer la capitalisation.");
  const [rdv] = projet.capitalisationRdvId
    ? await tx
        .select({ compteRenduAt: rendezVous.compteRenduAt })
        .from(rendezVous)
        .where(eq(rendezVous.id, projet.capitalisationRdvId))
    : [];
  await tx
    .update(diagnosticProjets)
    .set({
      capitalisationStatut: 'enregistre',
      capitalisationCompteRenduAt: rdv?.compteRenduAt ?? null,
      updatedAt: new Date(),
    })
    .where(eq(diagnosticProjets.id, id));
}
