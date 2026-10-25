import { eq } from 'drizzle-orm';
import type { Executor, Tx } from '../db.js';
import type { Instance } from '../instances/schema.js';
import { ChatIndisponible, envoyerMessage } from './chat.js';
import { diagnosticProjets, type Projet } from './schema.js';
import { ProjetIntrouvable, type ProjetVue } from './service.js';
import { contenuRapportSchema, genererRapportWord, type ContenuRapport } from './rapport-word.js';
import { SupportInvalide } from './support.js';

// Pré-requis du rapport : le résultat de l'étape 2. La revue de l'étape 3 enrichit le rapport
// quand elle existe, mais n'est pas exigée.
export function rapportPret(
  projet: Pick<Projet, 'dims'>,
): { ok: true } | { ok: false; raison: string } {
  if (!projet.dims) return { ok: false, raison: "Saisissez d'abord le résultat à l'étape 2." };
  return { ok: true };
}

// Le pilote demande le rapport : le runner le rédige, puis Claude enregistre son contenu, mis en
// page en fichier Word par l'OS.
export function demanderRapport(db: Executor, instance: Instance, id: string): Promise<ProjetVue> {
  return envoyerMessage(db, instance, id, 'Rédige le rapport du projet.', {
    type: 'rapport',
    etape: 4,
    maj: { rapportLienStatut: 'en_cours' },
    verifier: (projet) => {
      const pret = rapportPret(projet);
      if (!pret.ok) throw new ChatIndisponible(pret.raison);
      if (projet.rapportLienStatut === 'en_cours')
        throw new ChatIndisponible('Un rapport est déjà en cours de rédaction.');
    },
  });
}

const nomFichier = (entreprise: string) =>
  `Rapport Diagnostic Endurance - ${entreprise
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()}.docx`;

// Claude rend le contenu du rapport : l'OS le met en page en Word et le garde dans le projet, d'où
// le pilote le télécharge pour le relire ou le modifier. Un nouveau rapport remplace le précédent.
export async function enregistrerRapport(
  tx: Tx,
  id: string,
  contenu: ContenuRapport,
): Promise<void> {
  const [projet] = await tx.select().from(diagnosticProjets).where(eq(diagnosticProjets.id, id));
  if (!projet) throw new ProjetIntrouvable('Projet introuvable dans cette instance');
  if (projet.demande !== 'rapport')
    throw new SupportInvalide("Le pilote n'a pas demandé de rapport.");
  const lu = contenuRapportSchema.safeParse(contenu);
  if (!lu.success) throw new SupportInvalide('Contenu du rapport invalide.');
  const fichier = genererRapportWord(lu.data);
  await tx
    .update(diagnosticProjets)
    .set({
      rapport: Buffer.from(fichier).toString('base64'),
      rapportNom: nomFichier(lu.data.entreprise),
      rapportLienStatut: 'pret',
      updatedAt: new Date(),
    })
    .where(eq(diagnosticProjets.id, id));
}
