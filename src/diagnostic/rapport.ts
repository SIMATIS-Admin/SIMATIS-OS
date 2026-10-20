import { eq } from 'drizzle-orm';
import type { Executor, Tx } from '../db.js';
import type { Instance } from '../instances/schema.js';
import { ChatIndisponible, envoyerMessage } from './chat.js';
import { diagnosticProjets, type Projet } from './schema.js';
import { ProjetIntrouvable, type ProjetVue } from './service.js';
import { LIEN_ARTIFACT, SupportInvalide, type Decision } from './support.js';

// Pré-requis du rapport : le résultat de l'étape 2 et la revue validée à l'étape 3.
export function rapportPret(
  projet: Pick<Projet, 'dims' | 'revue'>,
): { ok: true } | { ok: false; raison: string } {
  if (!projet.dims) return { ok: false, raison: "Saisissez d'abord le résultat à l'étape 2." };
  if (projet.revue?.statut !== 'validée')
    return { ok: false, raison: "Validez d'abord la revue à l'étape 3." };
  return { ok: true };
}

// Le pilote demande le rapport à l'étape 4 : le runner le rédige, puis Claude enregistre son lien.
export function demanderRapport(db: Executor, instance: Instance, id: string): Promise<ProjetVue> {
  return envoyerMessage(
    db,
    instance,
    id,
    'Rédige le rapport du projet à partir de la revue validée.',
    {
      type: 'rapport',
      etape: 4,
      maj: { rapportLienStatut: 'en_cours' },
      verifier: (projet) => {
        const pret = rapportPret(projet);
        if (!pret.ok) throw new ChatIndisponible(pret.raison);
        if (projet.rapportLienStatut === 'en_cours')
          throw new ChatIndisponible('Un rapport est déjà en cours de rédaction.');
      },
    },
  );
}

// Claude rend le lien du rapport rédigé : il devient le lien affiché, l'ancien passe à l'historique.
export async function enregistrerRapport(tx: Tx, id: string, lien: string): Promise<void> {
  const [projet] = await tx.select().from(diagnosticProjets).where(eq(diagnosticProjets.id, id));
  if (!projet) throw new ProjetIntrouvable('Projet introuvable dans cette instance');
  if (projet.demande !== 'rapport')
    throw new SupportInvalide("Le pilote n'a pas demandé de rapport.");
  if (!LIEN_ARTIFACT.test(lien))
    throw new SupportInvalide('Lien du rapport refusé : un artifact claude.ai est attendu.');
  await tx
    .update(diagnosticProjets)
    .set({
      rapportLien: lien,
      rapportLienStatut: 'pret',
      rapportLiens: [{ lien, le: new Date().toISOString() }, ...projet.rapportLiens],
      updatedAt: new Date(),
    })
    .where(eq(diagnosticProjets.id, id));
}

// Permission d'outil pendant la rédaction du rapport : création d'artifacts permise, publication
// seulement sur le rapport du projet en cours. Renvoie null si le travail en cours n'est pas un rapport.
export async function autoriserSiRapport(
  tx: Tx,
  outil: string,
  input: Record<string, unknown>,
): Promise<Decision | null> {
  const enCours = await tx
    .select()
    .from(diagnosticProjets)
    .where(eq(diagnosticProjets.statutChat, 'en_cours'));
  const projet = enCours[0];
  if (enCours.length !== 1 || projet?.demande !== 'rapport') return null;
  const refus = (message: string): Decision => ({ behavior: 'deny', message });
  if (outil !== 'Artifact') return refus(`Outil ${outil} non autorisé pour le rapport.`);
  const action = typeof input.action === 'string' ? input.action : 'publish';
  if (['read', 'list', 'quickstart'].includes(action))
    return { behavior: 'allow', updatedInput: input };
  if (action !== 'publish') return refus(`Action ${action} non autorisée pour le rapport.`);
  if (input.url === undefined) return { behavior: 'allow', updatedInput: input };
  if (typeof input.url === 'string' && input.url === projet.rapportLien)
    return { behavior: 'allow', updatedInput: input };
  return refus(
    'Publication refusée : seul le rapport enregistré pour ce projet (enregistrer_rapport) peut être modifié.',
  );
}
