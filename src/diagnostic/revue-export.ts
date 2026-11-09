import { eq } from 'drizzle-orm';
import type { Executor, Tx } from '../db.js';
import type { Instance } from '../instances/schema.js';
import { ChatIndisponible, envoyerMessage } from './chat.js';
import { diagnosticProjets } from './schema.js';
import { ProjetIntrouvable, type ProjetVue } from './service.js';
import { LIEN_ARTIFACT, SupportInvalide, type Decision } from './support.js';

export const DEBUT_MESSAGE_EXPORT_REVUE = 'Exporter la revue pour Claude Chat';

// Le pilote veut reprendre la revue validée dans Claude Chat pour rédiger le rapport : le runner fait
// créer par Claude un artifact claude.ai, dont l'OS enregistre le lien (enregistrer_revue_export).
export function demanderExportRevue(
  db: Executor,
  instance: Instance,
  id: string,
): Promise<ProjetVue> {
  return envoyerMessage(db, instance, id, `${DEBUT_MESSAGE_EXPORT_REVUE}.`, {
    type: 'revue_exporter',
    etape: 3,
    maj: { revueExportStatut: 'en_cours' },
    verifier: (projet) => {
      if (projet.revue?.statut !== 'validée')
        throw new ChatIndisponible("Validez d'abord la revue à l'étape 3.");
      if (projet.revueExportStatut === 'en_cours')
        throw new ChatIndisponible("L'export de la revue est déjà en cours.");
    },
  });
}

// Claude rend le lien de l'artifact : il remplace le précédent (l'export se révise, il ne s'empile pas).
export async function enregistrerExportRevue(tx: Tx, id: string, lien: string): Promise<void> {
  const [projet] = await tx.select().from(diagnosticProjets).where(eq(diagnosticProjets.id, id));
  if (!projet) throw new ProjetIntrouvable('Projet introuvable dans cette instance');
  if (projet.demande !== 'revue_exporter')
    throw new SupportInvalide("Le pilote n'a pas demandé d'export de la revue.");
  if (!LIEN_ARTIFACT.test(lien))
    throw new SupportInvalide("Lien de l'export refusé : un artifact claude.ai est attendu.");
  await tx
    .update(diagnosticProjets)
    .set({ revueExportLien: lien, revueExportStatut: 'pret', updatedAt: new Date() })
    .where(eq(diagnosticProjets.id, id));
}

// Permission d'outil pendant l'export : seul l'artifact se manie, et la publication ne vise que
// l'artifact enregistré pour ce projet. Renvoie null hors export de revue.
export async function autoriserSiExportRevue(
  tx: Tx,
  outil: string,
  input: Record<string, unknown>,
): Promise<Decision | null> {
  const enCours = await tx
    .select()
    .from(diagnosticProjets)
    .where(eq(diagnosticProjets.statutChat, 'en_cours'));
  const projet = enCours[0];
  if (enCours.length !== 1 || projet?.demande !== 'revue_exporter') return null;
  const refus = (message: string): Decision => ({ behavior: 'deny', message });
  if (outil !== 'Artifact') return refus(`Outil ${outil} non autorisé pour l'export de la revue.`);
  const action = typeof input.action === 'string' ? input.action : 'publish';
  if (['read', 'list', 'quickstart'].includes(action))
    return { behavior: 'allow', updatedInput: input };
  if (action !== 'publish') return refus(`Action ${action} non autorisée pour l'export.`);
  if (input.url === undefined) return { behavior: 'allow', updatedInput: input };
  if (typeof input.url === 'string' && input.url === projet.revueExportLien)
    return { behavior: 'allow', updatedInput: input };
  return refus(
    "Publication refusée : seul l'artifact enregistré pour l'export de ce projet (enregistrer_revue_export) peut être modifié.",
  );
}
