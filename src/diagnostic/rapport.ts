import { eq } from 'drizzle-orm';
import type { Executor, Tx } from '../db.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { ChatIndisponible, envoyerMessage } from './chat.js';
import { diagnosticProjets, type Projet } from './schema.js';
import { ProjetIntrouvable, type ProjetVue } from './service.js';
import {
  contenuRapportSchema,
  genererRapportWord,
  nomFichier,
  type ContenuRapport,
} from './rapport-word.js';
import { SupportInvalide } from './support.js';

// Pré-requis du rapport : le résultat de l'étape 2. La revue de l'étape 3 enrichit le rapport
// quand elle existe, mais n'est pas exigée.
export function rapportPret(
  projet: Pick<Projet, 'dims'>,
): { ok: true } | { ok: false; raison: string } {
  if (!projet.dims) return { ok: false, raison: "Saisissez d'abord le résultat à l'étape 2." };
  return { ok: true };
}

// Numéro de la prochaine version : un Word importé compte pour la version 1.
export const prochaineVersion = (projet: Pick<Projet, 'rapportVersions' | 'rapportNom'>) =>
  Math.max(projet.rapportVersions.at(-1)?.version ?? 0, projet.rapportNom ? 1 : 0) + 1;

// Début du message du pilote qui lance une production : il borne, dans la conversation de l'étape 4,
// les modifications à intégrer (celles écrites depuis la production précédente).
export const DEBUT_MESSAGE_RAPPORT = 'Produire le rapport version';

// Le pilote lance la production : le runner rédige à partir de ses modifications (conversation de
// l'étape 4), puis Claude enregistre le contenu, mis en page en Word par l'OS.
export function demanderRapport(db: Executor, instance: Instance, id: string): Promise<ProjetVue> {
  return withInstance(db, instance.id, async (tx) => {
    const [projet] = await tx.select().from(diagnosticProjets).where(eq(diagnosticProjets.id, id));
    return projet ? prochaineVersion(projet) : 1;
  }).then((version) =>
    envoyerMessage(db, instance, id, `${DEBUT_MESSAGE_RAPPORT} ${version}.`, {
      type: 'rapport',
      etape: 4,
      maj: { rapportLienStatut: 'en_cours' },
      verifier: (projet) => {
        const pret = rapportPret(projet);
        if (!pret.ok) throw new ChatIndisponible(pret.raison);
        if (projet.rapportLienStatut === 'en_cours')
          throw new ChatIndisponible('Un rapport est déjà en cours de rédaction.');
      },
    }),
  );
}

// Claude rend le contenu du rapport : l'OS le met en page en Word et le garde dans le projet, d'où
// le pilote le télécharge pour le relire ou le modifier. Chaque production crée une nouvelle version ;
// les précédentes restent téléchargeables.
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
  const version = prochaineVersion(projet);
  const fichier = genererRapportWord(lu.data);
  await tx
    .update(diagnosticProjets)
    .set({
      rapport: Buffer.from(fichier).toString('base64'),
      rapportNom: nomFichier(lu.data.entreprise, version),
      rapportVersions: [
        ...projet.rapportVersions,
        { version, le: new Date().toISOString(), contenu: lu.data },
      ],
      rapportLienStatut: 'pret',
      updatedAt: new Date(),
    })
    .where(eq(diagnosticProjets.id, id));
}
