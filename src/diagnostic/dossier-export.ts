import { eq } from 'drizzle-orm';
import type { Executor, Tx } from '../db.js';
import type { Instance } from '../instances/schema.js';
import { ChatIndisponible, envoyerMessage } from './chat.js';
import { rapportPret } from './rapport.js';
import { diagnosticProjets } from './schema.js';
import { ProjetIntrouvable, type ProjetVue } from './service.js';
import { LIEN_ARTIFACT, SupportInvalide, type Decision } from './support.js';

export const DEBUT_MESSAGE_DOSSIER = 'Préparer le dossier de travail du rapport';

// Le pilote veut rédiger le rapport dans Claude Chat : le runner fait créer par Claude un artifact
// claude.ai qui réunit tout ce qu'il faut (résultat, contexte, revue, consigne de départ), dont l'OS
// enregistre le lien (enregistrer_dossier_rapport). Même mécanique que l'export de la revue.
export function demanderDossier(db: Executor, instance: Instance, id: string): Promise<ProjetVue> {
  return envoyerMessage(db, instance, id, `${DEBUT_MESSAGE_DOSSIER}.`, {
    type: 'dossier_exporter',
    etape: 4,
    maj: { dossierExportStatut: 'en_cours' },
    verifier: (projet) => {
      const pret = rapportPret(projet);
      if (!pret.ok) throw new ChatIndisponible(pret.raison);
      if (projet.dossierExportStatut === 'en_cours')
        throw new ChatIndisponible('Le dossier de travail est déjà en préparation.');
    },
  });
}

// Claude rend le lien de l'artifact : il remplace le précédent (le dossier se révise, il ne s'empile pas).
export async function enregistrerDossier(tx: Tx, id: string, lien: string): Promise<void> {
  const [projet] = await tx.select().from(diagnosticProjets).where(eq(diagnosticProjets.id, id));
  if (!projet) throw new ProjetIntrouvable('Projet introuvable dans cette instance');
  if (projet.demande !== 'dossier_exporter')
    throw new SupportInvalide("Le pilote n'a pas demandé de dossier de travail.");
  if (!LIEN_ARTIFACT.test(lien))
    throw new SupportInvalide('Lien du dossier refusé : un artifact claude.ai est attendu.');
  await tx
    .update(diagnosticProjets)
    .set({ dossierExportLien: lien, dossierExportStatut: 'pret', updatedAt: new Date() })
    .where(eq(diagnosticProjets.id, id));
}

// Permission d'outil pendant la préparation : seul l'artifact se manie, et la publication ne vise que
// l'artifact enregistré pour ce projet. Renvoie null hors préparation du dossier.
export async function autoriserSiDossier(
  tx: Tx,
  outil: string,
  input: Record<string, unknown>,
): Promise<Decision | null> {
  const enCours = await tx
    .select()
    .from(diagnosticProjets)
    .where(eq(diagnosticProjets.statutChat, 'en_cours'));
  const projet = enCours[0];
  if (enCours.length !== 1 || projet?.demande !== 'dossier_exporter') return null;
  const refus = (message: string): Decision => ({ behavior: 'deny', message });
  if (outil !== 'Artifact') return refus(`Outil ${outil} non autorisé pour le dossier de travail.`);
  const action = typeof input.action === 'string' ? input.action : 'publish';
  if (['read', 'list', 'quickstart'].includes(action))
    return { behavior: 'allow', updatedInput: input };
  if (action !== 'publish') return refus(`Action ${action} non autorisée pour le dossier.`);
  if (input.url === undefined) return { behavior: 'allow', updatedInput: input };
  if (typeof input.url === 'string' && input.url === projet.dossierExportLien)
    return { behavior: 'allow', updatedInput: input };
  return refus(
    "Publication refusée : seul l'artifact enregistré pour le dossier de ce projet (enregistrer_dossier_rapport) peut être modifié.",
  );
}
