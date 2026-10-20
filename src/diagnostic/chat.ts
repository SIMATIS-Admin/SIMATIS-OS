import { and, eq } from 'drizzle-orm';
import type { Executor, Tx } from '../db.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { listInstances } from '../instances/service.js';
import { diagnosticProjets, type Demande, type MessageDiag, type Projet } from './schema.js';
import { ProjetIntrouvable, verifierEspace, vue, type ProjetVue } from './service.js';

// Conversation avec Claude dans l'OS : le pilote écrit, le runner de son poste fait répondre Claude
// (avec le temps de réponse de Claude Code), et la réponse revient dans la conversation.
export class ChatIndisponible extends Error {}
export const REPONSE_ABSENTE = "Claude n'a pas répondu. Réécrivez votre message pour réessayer.";
const MESSAGE_MAX = 4000;

const lire = async (tx: Tx, instanceId: string, id: string): Promise<Projet> => {
  const [row] = await tx
    .select()
    .from(diagnosticProjets)
    .where(and(eq(diagnosticProjets.id, id), eq(diagnosticProjets.instanceId, instanceId)));
  if (!row) throw new ProjetIntrouvable('Projet introuvable dans cette instance');
  return row;
};

// Le pilote écrit : un seul message en attente à la fois, pour que les réponses restent dans l'ordre.
export async function envoyerMessage(
  db: Executor,
  instance: Instance,
  id: string,
  texte: string,
  // Bouton du support : le message porte la demande et reste à l'étape 1, même plus tard.
  demande?: {
    type: Demande;
    verifier: (projet: Projet) => void;
    // Étape du message : le rapport se demande à l'étape 4, les boutons du support à l'étape 1.
    etape?: number;
    // Champs posés en même temps que la demande (ex. statut du rapport en cours).
    maj?: Partial<Projet>;
  },
): Promise<ProjetVue> {
  verifierEspace(instance);
  const message = texte.trim();
  if (!message || message.length > MESSAGE_MAX)
    throw new ChatIndisponible('Message vide ou trop long');
  return withInstance(db, instance.id, async (tx) => {
    const projet = await lire(tx, instance.id, id);
    if (projet.statutChat !== 'repos')
      throw new ChatIndisponible('Claude répond déjà à ce projet : attendez sa réponse.');
    demande?.verifier(projet);
    const nouveau: MessageDiag = {
      etape: demande ? (demande.etape ?? 1) : projet.etape,
      de: 'pilote',
      texte: message,
      at: new Date().toISOString(),
    };
    const [row] = await tx
      .update(diagnosticProjets)
      .set({
        conversation: [...projet.conversation, nouveau],
        statutChat: 'attente_claude',
        demande: demande?.type ?? null,
        ...(demande?.type === 'preparer_support' ? { supportStatut: 'preparation' as const } : {}),
        ...demande?.maj,
        updatedAt: new Date(),
      })
      .where(and(eq(diagnosticProjets.id, id), eq(diagnosticProjets.instanceId, instance.id)))
      .returning();
    return vue(row!);
  });
}

// Claude répond (outil repondre_diagnostic) : la réponse est rangée à l'étape du dernier message du pilote.
export async function repondreClaude(tx: Tx, id: string, texte: string): Promise<void> {
  const [projet] = await tx.select().from(diagnosticProjets).where(eq(diagnosticProjets.id, id));
  if (!projet) throw new ProjetIntrouvable('Projet introuvable dans cette instance');
  const dernier = [...projet.conversation].reverse().find((m) => m.de === 'pilote');
  const reponse: MessageDiag = {
    etape: dernier?.etape ?? projet.etape,
    de: 'claude',
    texte: texte.trim(),
    at: new Date().toISOString(),
  };
  await tx
    .update(diagnosticProjets)
    .set({
      conversation: [...projet.conversation, reponse],
      statutChat: 'repos',
      updatedAt: new Date(),
    })
    .where(eq(diagnosticProjets.id, id));
}

// Le runner prend la demande : elle passe en cours, pour qu'un autre runner ne la reprenne pas.
export async function demarrerAttente(
  db: Executor,
  instance: Instance,
  id: string,
): Promise<Projet> {
  return withInstance(db, instance.id, async (tx) => {
    const [row] = await tx
      .update(diagnosticProjets)
      .set({ statutChat: 'en_cours' })
      .where(
        and(
          eq(diagnosticProjets.id, id),
          eq(diagnosticProjets.instanceId, instance.id),
          eq(diagnosticProjets.statutChat, 'attente_claude'),
        ),
      )
      .returning();
    if (!row) throw new ChatIndisponible('Pas de message en attente pour ce projet.');
    return row;
  });
}

// Fin du travail du runner : si Claude n'a pas répondu, le pilote en est averti et peut réécrire.
export async function finirAttente(
  db: Executor,
  instance: Instance,
  id: string,
  erreur?: string,
): Promise<void> {
  await withInstance(db, instance.id, async (tx) => {
    const projet = await lire(tx, instance.id, id);
    // Un support resté en préparation (Claude n'a pas enregistré de deck) redevient modifiable.
    const support =
      projet.supportStatut === 'preparation'
        ? { supportStatut: projet.supportLien ? ('pret' as const) : ('aucun' as const) }
        : {};
    if (projet.statutChat !== 'en_cours') {
      await tx
        .update(diagnosticProjets)
        .set({ ...support, demande: null })
        .where(eq(diagnosticProjets.id, id));
      return;
    }
    const dernier = [...projet.conversation].reverse().find((m) => m.de === 'pilote');
    const absence: MessageDiag = {
      etape: dernier?.etape ?? projet.etape,
      de: 'claude',
      texte: erreur ?? REPONSE_ABSENTE,
      at: new Date().toISOString(),
      erreur: true,
    };
    await tx
      .update(diagnosticProjets)
      .set({
        ...support,
        conversation: [...projet.conversation, absence],
        statutChat: 'repos',
        demande: null,
      })
      .where(eq(diagnosticProjets.id, id));
  });
}

// Messages en attente sur toutes les instances SIMATIS (le runner ne traite que l'espace SIMATIS).
export async function attentesClaude(db: Executor) {
  const sorties = [];
  for (const instance of (await listInstances(db)).filter((i) => i.type === 'propre')) {
    const rows = await withInstance(db, instance.id, (tx) =>
      tx.select().from(diagnosticProjets).where(eq(diagnosticProjets.statutChat, 'attente_claude')),
    );
    for (const p of rows) {
      const dernier = [...p.conversation].reverse().find((m) => m.de === 'pilote');
      sorties.push({
        id: p.id,
        instance: instance.slug,
        nom: p.nom,
        activite: p.activite,
        contexte: p.contexte,
        etape: p.etape,
        profil: vue(p).profil,
        dims: p.dims,
        statutDiagnostic: p.statutDiagnostic,
        revue: p.revue,
        conversation: p.conversation,
        etapeMessage: dernier?.etape ?? p.etape,
        modele: p.chats[String(dernier?.etape ?? p.etape)]?.modele ?? null,
        demande: p.demande,
        dateDiagnostic: p.dateDiagnostic,
        ditParDirigeant: p.ditParDirigeant,
        hypotheses: p.hypotheses,
        supportStatut: p.supportStatut,
        supportLien: p.supportLien,
        // Le logo ne voyage que pour préparer le deck.
        logo:
          p.demande === 'preparer_support' && p.logo && p.logoNom
            ? { nom: p.logoNom, base64: p.logo }
            : null,
      });
    }
  }
  return sorties;
}
