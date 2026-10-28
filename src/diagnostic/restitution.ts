import { and, eq } from 'drizzle-orm';
import type { Executor, Tx } from '../db.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { ChatIndisponible, envoyerMessage } from './chat.js';
import { genererDeckPptx, nomFichierDeck } from './restitution-pptx.js';
import { diagnosticProjets, type Diapositive, type Projet } from './schema.js';
import { ProjetIntrouvable, verifierEspace, type ProjetVue } from './service.js';
import { LIEN_ARTIFACT, SupportInvalide, type Decision } from './support.js';

// Deck de restitution (étape 5) : le pilote le demande une fois le rapport rédigé ; le runner le
// fait créer par Claude (artifact), qui rend son lien par enregistrer_restitution. Les éléments de
// la proposition de collaboration se donnent dans le chat de l'étape 5.
export const DEBUT_MESSAGE_RESTITUTION = 'Produire le deck de restitution';

export function restitutionPrete(
  projet: Pick<Projet, 'rapportVersions' | 'rapportNom'>,
): { ok: true } | { ok: false; raison: string } {
  if (!projet.rapportNom && projet.rapportVersions.length === 0)
    return { ok: false, raison: "Produisez d'abord le rapport à l'étape 4." };
  return { ok: true };
}

export function demanderRestitution(
  db: Executor,
  instance: Instance,
  id: string,
): Promise<ProjetVue> {
  return envoyerMessage(db, instance, id, `${DEBUT_MESSAGE_RESTITUTION}.`, {
    type: 'restitution',
    etape: 5,
    maj: { restitutionStatut: 'en_cours' },
    verifier: (projet) => {
      const pret = restitutionPrete(projet);
      if (!pret.ok) throw new ChatIndisponible(pret.raison);
      if (projet.restitutionStatut === 'en_cours')
        throw new ChatIndisponible('Un deck de restitution est déjà en cours de création.');
    },
  });
}

// Export PowerPoint : le pilote le demande quand le deck lui convient. Claude relit le deck publié
// et rend ses diapositives, dont l'OS fait le fichier.
export const DEBUT_MESSAGE_EXPORT = 'Exporter le deck de restitution en PowerPoint';

export function demanderExportRestitution(
  db: Executor,
  instance: Instance,
  id: string,
): Promise<ProjetVue> {
  return envoyerMessage(db, instance, id, `${DEBUT_MESSAGE_EXPORT}.`, {
    type: 'restitution_export',
    etape: 5,
    verifier: (projet) => {
      if (!projet.restitutionLien)
        throw new ChatIndisponible("Aucun deck de restitution n'est encore enregistré.");
      if (projet.restitutionStatut === 'en_cours')
        throw new ChatIndisponible('Le deck de restitution est en cours de création.');
    },
  });
}

// Claude rend les diapositives relues dans le deck publié, sur demande d'export seulement.
export async function enregistrerDiapositivesRestitution(
  tx: Tx,
  id: string,
  diapositives: Diapositive[],
): Promise<void> {
  const [projet] = await tx.select().from(diagnosticProjets).where(eq(diagnosticProjets.id, id));
  if (!projet) throw new ProjetIntrouvable('Projet introuvable dans cette instance');
  if (projet.demande !== 'restitution_export')
    throw new SupportInvalide("Le pilote n'a pas demandé d'export PowerPoint.");
  await tx
    .update(diagnosticProjets)
    .set({
      restitutionDiapos: diapositives,
      restitutionExportLe: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(diagnosticProjets.id, id));
}

// Le fichier PowerPoint se fait au téléchargement, depuis les dernières diapositives exportées.
export async function pptxRestitutionDe(
  db: Executor,
  instance: Instance,
  id: string,
): Promise<{ nom: string; contenu: Buffer }> {
  verifierEspace(instance);
  const [row] = await withInstance(db, instance.id, (tx) =>
    tx
      .select({ nom: diagnosticProjets.nom, diapos: diagnosticProjets.restitutionDiapos })
      .from(diagnosticProjets)
      .where(and(eq(diagnosticProjets.id, id), eq(diagnosticProjets.instanceId, instance.id))),
  );
  if (!row) throw new ProjetIntrouvable('Projet introuvable dans cette instance');
  if (!row.diapos) throw new ProjetIntrouvable("Aucun PowerPoint n'a encore été exporté");
  const octets = await genererDeckPptx({ entreprise: row.nom, diapositives: row.diapos });
  return { nom: nomFichierDeck(row.nom), contenu: Buffer.from(octets) };
}

// Claude rend le lien du deck : il devient le lien affiché, l'ancien passe à l'historique.
export async function enregistrerRestitution(tx: Tx, id: string, lien: string): Promise<void> {
  const [projet] = await tx.select().from(diagnosticProjets).where(eq(diagnosticProjets.id, id));
  if (!projet) throw new ProjetIntrouvable('Projet introuvable dans cette instance');
  if (projet.demande !== 'restitution')
    throw new SupportInvalide("Le pilote n'a pas demandé de deck de restitution.");
  if (!LIEN_ARTIFACT.test(lien))
    throw new SupportInvalide('Lien du deck refusé : un artifact claude.ai est attendu.');
  await tx
    .update(diagnosticProjets)
    .set({
      restitutionLien: lien,
      restitutionStatut: 'pret',
      restitutionLiens: [{ lien, le: new Date().toISOString() }, ...projet.restitutionLiens],
      updatedAt: new Date(),
    })
    .where(eq(diagnosticProjets.id, id));
}

// Permission d'outil pendant la création du deck : création d'artifacts permise, publication
// seulement sur le deck de restitution du projet en cours. Renvoie null hors restitution.
export async function autoriserSiRestitution(
  tx: Tx,
  outil: string,
  input: Record<string, unknown>,
): Promise<Decision | null> {
  const enCours = await tx
    .select()
    .from(diagnosticProjets)
    .where(eq(diagnosticProjets.statutChat, 'en_cours'));
  const projet = enCours[0];
  const refus = (message: string): Decision => ({ behavior: 'deny', message });
  // Export PowerPoint : le deck se lit seulement, rien ne s'y publie.
  if (enCours.length === 1 && projet?.demande === 'restitution_export')
    return outil === 'Artifact' && input.action === 'read'
      ? { behavior: 'allow', updatedInput: input }
      : refus("Pendant l'export PowerPoint, seule la lecture du deck est permise.");
  if (enCours.length !== 1 || projet?.demande !== 'restitution') return null;
  if (outil !== 'Artifact')
    return refus(`Outil ${outil} non autorisé pour le deck de restitution.`);
  const action = typeof input.action === 'string' ? input.action : 'publish';
  if (['read', 'list', 'quickstart'].includes(action))
    return { behavior: 'allow', updatedInput: input };
  if (action !== 'publish') return refus(`Action ${action} non autorisée pour le deck.`);
  if (input.url === undefined) return { behavior: 'allow', updatedInput: input };
  if (typeof input.url === 'string' && input.url === projet.restitutionLien)
    return { behavior: 'allow', updatedInput: input };
  return refus(
    'Publication refusée : seul le deck de restitution enregistré pour ce projet (enregistrer_restitution) peut être modifié.',
  );
}
