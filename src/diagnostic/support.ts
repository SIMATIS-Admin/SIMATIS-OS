import { and, eq } from 'drizzle-orm';
import type { Executor, Tx } from '../db.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { ChatIndisponible, envoyerMessage } from './chat.js';
import { diagnosticProjets, type Diapositive, type Projet } from './schema.js';
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
