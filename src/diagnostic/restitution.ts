import { eq } from 'drizzle-orm';
import type { Executor, Tx } from '../db.js';
import type { Instance } from '../instances/schema.js';
import { ChatIndisponible, envoyerMessage } from './chat.js';
import { diagnosticProjets, type Projet } from './schema.js';
import { ProjetIntrouvable, type ProjetVue } from './service.js';
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
  if (enCours.length !== 1 || projet?.demande !== 'restitution') return null;
  const refus = (message: string): Decision => ({ behavior: 'deny', message });
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
