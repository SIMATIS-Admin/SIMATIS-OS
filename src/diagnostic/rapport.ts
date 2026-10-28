import { and, eq } from 'drizzle-orm';
import type { Executor, Tx } from '../db.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { ChatIndisponible, envoyerMessage } from './chat.js';
import { diagnosticProjets, type Projet } from './schema.js';
import { ProjetIntrouvable, verifierEspace, vue, type ProjetVue } from './service.js';
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

// Numéro lu dans le nom du Word (« … - v3.docx ») : un rapport retravaillé hors de l'OS et importé
// garde le numéro que Marc lui a donné. Sans numéro dans le nom, un Word importé compte pour la 1.
export const versionDuNom = (nom: string | null): number => {
  if (!nom) return 0;
  const lu = /\bv(\d{1,3})\.docx$/i.exec(nom.trim());
  return lu ? Number(lu[1]) : 1;
};

// Numéro de la prochaine version, à partir de la dernière produite ou importée.
export const prochaineVersion = (projet: Pick<Projet, 'rapportVersions' | 'rapportNom'>) =>
  Math.max(projet.rapportVersions.at(-1)?.version ?? 0, versionDuNom(projet.rapportNom)) + 1;

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

const WORD_MAX = 10 * 1024 * 1024;

// Marc retravaille le rapport hors de l'OS : sa version remplace le Word affiché (ses versions
// rédigées par Claude restent téléchargeables) et la production suivante part de son numéro.
export async function importerRapport(
  db: Executor,
  instance: Instance,
  id: string,
  word: { nom: string; base64: string },
): Promise<ProjetVue> {
  verifierEspace(instance);
  const octets = Buffer.from(word.base64, 'base64');
  if (octets.length > WORD_MAX) throw new ChatIndisponible('Word trop lourd (10 Mo au plus).');
  // Un .docx est une archive zip : « PK » en tête.
  if (!/\.docx$/i.test(word.nom) || !octets.subarray(0, 2).equals(Buffer.from('PK')))
    throw new ChatIndisponible("Ce fichier n'est pas un Word (.docx).");
  return withInstance(db, instance.id, async (tx) => {
    const [projet] = await tx
      .select()
      .from(diagnosticProjets)
      .where(and(eq(diagnosticProjets.id, id), eq(diagnosticProjets.instanceId, instance.id)));
    if (!projet) throw new ProjetIntrouvable('Projet introuvable dans cette instance');
    if (projet.rapportLienStatut === 'en_cours')
      throw new ChatIndisponible('Un rapport est en cours de rédaction : attendez sa fin.');
    const [row] = await tx
      .update(diagnosticProjets)
      .set({
        rapport: octets.toString('base64'),
        rapportNom: word.nom.trim().slice(0, 200),
        rapportLienStatut: 'pret',
        updatedAt: new Date(),
      })
      .where(and(eq(diagnosticProjets.id, id), eq(diagnosticProjets.instanceId, instance.id)))
      .returning();
    return vue(row!);
  });
}
