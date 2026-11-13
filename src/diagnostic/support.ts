import { and, eq } from 'drizzle-orm';
import type { Executor, Tx } from '../db.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { ChatIndisponible, envoyerMessage, finirAttente } from './chat.js';
import { diagnosticProjets, type Demande, type Diapositive, type Projet } from './schema.js';
import { ProjetIntrouvable, verifierEspace, vue, type ProjetVue } from './service.js';

// Support d'ouverture : le pilote demande, le runner fait préparer ou archiver le deck par Claude
// (skill support), et Claude rend le lien puis le texte final par l'outil enregistrer_support.
export class SupportInvalide extends Error {}

export const LIEN_ARTIFACT = /^https:\/\/claude\.ai\/(code\/)?artifact\/[\w-]{8,64}$/;

const MESSAGES = {
  preparer_support: 'Préparer le support à partir du formulaire.',
  support_final: 'Le support est final : archive-le.',
} as const;

export function demanderSupport(
  db: Executor,
  instance: Instance,
  id: string,
  type: keyof typeof MESSAGES,
): Promise<ProjetVue> {
  return envoyerMessage(db, instance, id, MESSAGES[type], {
    type,
    verifier: (projet) => {
      if (projet.supportStatut === 'final')
        throw new ChatIndisponible('Le support est final : rouvrez-le pour le modifier.');
      if (type === 'support_final' && !projet.supportLien)
        throw new ChatIndisponible("Aucun deck n'est encore enregistré pour ce projet.");
    },
  });
}

// Envoi du deck d'introduction au lecteur de l'OS : Claude récupère les fichiers du deck publié.
export const DEBUT_MESSAGE_ENVOI_INTRODUCTION = "Envoyer le support d'ouverture au lecteur";

export function demanderEnvoiIntroduction(
  db: Executor,
  instance: Instance,
  id: string,
): Promise<ProjetVue> {
  return envoyerMessage(db, instance, id, `${DEBUT_MESSAGE_ENVOI_INTRODUCTION}.`, {
    type: 'support_envoyer',
    etape: 1,
    verifier: (projet) => {
      if (!projet.supportLien)
        throw new ChatIndisponible("Aucun deck n'est encore enregistré pour ce projet.");
      if (projet.supportStatut === 'preparation')
        throw new ChatIndisponible('Le support est en cours de préparation.');
    },
  });
}

// Début du message qui lance la capitalisation des règles à partir du support final.
export const DEBUT_MESSAGE_REGLES_SUPPORT = 'Capitaliser le support final';

// Claude compare le support final aux supports finaux précédents, met à jour la fiche de règles du
// support dans le second cerveau et déclare ses changements au journal.
export function demanderCapitalisationSupport(
  db: Executor,
  instance: Instance,
  id: string,
): Promise<ProjetVue> {
  return envoyerMessage(db, instance, id, `${DEBUT_MESSAGE_REGLES_SUPPORT}.`, {
    type: 'regles_support',
    etape: 1,
    verifier: (projet) => {
      if (projet.supportStatut !== 'final' || !projet.supportTexte?.length)
        throw new ChatIndisponible("Archivez d'abord le support final de ce projet.");
    },
  });
}

// Après une demande « support final », la capitalisation suit d'elle-même. Si Claude répond déjà ou
// si le support n'est pas final, rien ne part : le pilote peut la relancer à la main.
export async function capitaliserSiSupportFinal(
  db: Executor,
  instance: Instance,
  id: string,
  demandeTerminee: Demande | null,
): Promise<void> {
  if (demandeTerminee !== 'support_final') return;
  try {
    await demanderCapitalisationSupport(db, instance, id);
  } catch (error) {
    if (!(error instanceof ChatIndisponible)) throw error;
  }
}

// Fin du travail du runner sur un projet : clôt la demande, puis enchaîne la capitalisation d'un
// support qui vient d'être archivé (sauf si le travail s'est arrêté en erreur).
export async function finDeDemande(
  db: Executor,
  instance: Instance,
  id: string,
  erreur?: string,
): Promise<void> {
  const demande = await withInstance(db, instance.id, async (tx) => {
    const [projet] = await tx
      .select({ demande: diagnosticProjets.demande })
      .from(diagnosticProjets)
      .where(eq(diagnosticProjets.id, id));
    return projet?.demande ?? null;
  });
  await finirAttente(db, instance, id, erreur);
  if (!erreur) await capitaliserSiSupportFinal(db, instance, id, demande);
}

// Rouvrir un support final pour le corriger : un nouveau « Support final » remplacera le texte.
export async function rouvrirSupport(
  db: Executor,
  instance: Instance,
  id: string,
): Promise<ProjetVue> {
  verifierEspace(instance);
  return withInstance(db, instance.id, async (tx) => {
    const [row] = await tx
      .update(diagnosticProjets)
      .set({ supportStatut: 'pret', updatedAt: new Date() })
      .where(
        and(
          eq(diagnosticProjets.id, id),
          eq(diagnosticProjets.instanceId, instance.id),
          eq(diagnosticProjets.supportStatut, 'final'),
        ),
      )
      .returning();
    if (!row) throw new ChatIndisponible("Le support de ce projet n'est pas final.");
    return vue(row);
  });
}

// Claude enregistre le deck du projet (lien), puis, sur demande « Support final », son texte.
export async function enregistrerSupport(
  tx: Tx,
  id: string,
  input: { lien?: string; diapositives?: Diapositive[] },
): Promise<void> {
  const [projet] = await tx.select().from(diagnosticProjets).where(eq(diagnosticProjets.id, id));
  if (!projet) throw new ProjetIntrouvable('Projet introuvable dans cette instance');
  const lien = input.lien ?? projet.supportLien;
  if (!lien) throw new SupportInvalide('Lien du deck manquant');
  let maj: Partial<Projet>;
  if (input.diapositives) {
    // Le texte final ne s'archive que sur demande du pilote, jamais pendant une préparation.
    if (projet.demande !== 'support_final')
      throw new SupportInvalide("Le pilote n'a pas déclaré le support final.");
    maj = {
      supportLien: lien,
      supportTexte: input.diapositives,
      supportStatut: 'final',
      supportFinalLe: new Date(),
    };
  } else {
    // Un support final ne change que s'il est rouvert par le pilote.
    if (projet.supportStatut === 'final')
      throw new SupportInvalide('Le support est final : le pilote doit le rouvrir.');
    maj = { supportLien: lien, supportStatut: 'pret' };
  }
  await tx
    .update(diagnosticProjets)
    .set({ ...maj, updatedAt: new Date() })
    .where(eq(diagnosticProjets.id, id));
}

export const TYPES_LOGO = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
} as const;

export const typeLogo = (nom: string) =>
  TYPES_LOGO[(nom.split('.').pop() ?? '').toLowerCase() as keyof typeof TYPES_LOGO] ?? null;

export async function logoDe(
  db: Executor,
  instance: Instance,
  id: string,
): Promise<{ type: string; contenu: Buffer }> {
  verifierEspace(instance);
  return withInstance(db, instance.id, async (tx) => {
    const [row] = await tx
      .select({ logo: diagnosticProjets.logo, nom: diagnosticProjets.logoNom })
      .from(diagnosticProjets)
      .where(and(eq(diagnosticProjets.id, id), eq(diagnosticProjets.instanceId, instance.id)));
    if (!row) throw new ProjetIntrouvable('Projet introuvable dans cette instance');
    const type = row.nom ? typeLogo(row.nom) : null;
    if (!row.logo || !type) throw new ProjetIntrouvable('Aucun logo pour ce projet');
    return { type, contenu: Buffer.from(row.logo, 'base64') };
  });
}

// Réponse aux demandes de confirmation de Claude Code pendant une demande du support (option
// --permission-prompt-tool du runner) : personne n'est là pour cliquer. Seul le deck enregistré
// pour le projet en cours peut recevoir des fichiers ; le deck modèle et ceux des autres
// entreprises restent hors d'atteinte.
export type Decision =
  { behavior: 'allow'; updatedInput: unknown } | { behavior: 'deny'; message: string };

export async function autoriserOutil(
  tx: Tx,
  outil: string,
  input: Record<string, unknown>,
): Promise<Decision> {
  const refus = (message: string): Decision => ({ behavior: 'deny', message });
  if (outil !== 'Artifact') return refus(`Outil ${outil} non autorisé pour le support.`);
  const action = typeof input.action === 'string' ? input.action : 'publish';
  if (['read', 'list', 'quickstart'].includes(action))
    return { behavior: 'allow', updatedInput: input };
  if (action !== 'publish') return refus(`Action ${action} non autorisée sur un deck.`);
  // Créer un deck depuis un type (sans url) est permis : il appartient au projet une fois enregistré.
  if (input.url === undefined && typeof input.type_url === 'string')
    return { behavior: 'allow', updatedInput: input };
  const enCours = await tx
    .select({ lien: diagnosticProjets.supportLien })
    .from(diagnosticProjets)
    .where(eq(diagnosticProjets.statutChat, 'en_cours'));
  const liens = enCours.map((p) => p.lien).filter((l): l is string => l !== null);
  if (typeof input.url === 'string' && liens.length === 1 && input.url === liens[0])
    return { behavior: 'allow', updatedInput: input };
  return refus(
    'Publication refusée : seul le deck enregistré pour ce projet (enregistrer_support) peut être modifié, jamais le deck modèle.',
  );
}
