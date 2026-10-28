import { and, eq } from 'drizzle-orm';
import type { Executor, Tx } from '../db.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { ChatIndisponible, envoyerMessage } from './chat.js';
import { envoyerRapportSurDrive, type DriveDeps, type EnvoiDrive } from './drive.js';
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
  // « … - v3 (1).docx » : le navigateur ajoute « (1) » quand le fichier existe déjà. Pas de \b
  // devant le « v » : l'underscore est un caractère de mot (« …_-_v3 »).
  const lu = /(?<![A-Za-z0-9])v(\d{1,3})(?:\s*\(\d+\))?\.docx$/i.exec(nom.trim());
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
// les précédentes restent téléchargeables. Avec Drive branché, la version est aussi envoyée en
// Google Doc, dont le lien devient celui du rapport.
export async function enregistrerRapport(
  tx: Tx,
  id: string,
  contenu: ContenuRapport,
  drive?: { instance: Instance; deps: DriveDeps },
): Promise<EnvoiDrive> {
  const [projet] = await tx.select().from(diagnosticProjets).where(eq(diagnosticProjets.id, id));
  if (!projet) throw new ProjetIntrouvable('Projet introuvable dans cette instance');
  if (projet.demande !== 'rapport')
    throw new SupportInvalide("Le pilote n'a pas demandé de rapport.");
  const lu = contenuRapportSchema.safeParse(contenu);
  if (!lu.success) throw new SupportInvalide('Contenu du rapport invalide.');
  const version = prochaineVersion(projet);
  const fichier = genererRapportWord(lu.data);
  const nomWord = nomFichier(lu.data.entreprise, version);
  await tx
    .update(diagnosticProjets)
    .set({
      rapport: Buffer.from(fichier).toString('base64'),
      rapportNom: nomWord,
      rapportVersions: [
        ...projet.rapportVersions,
        { version, le: new Date().toISOString(), contenu: lu.data },
      ],
      rapportLienStatut: 'pret',
      updatedAt: new Date(),
    })
    .where(eq(diagnosticProjets.id, id));
  if (!drive) return { statut: 'indisponible' };
  return envoyerRapportSurDrive(
    tx,
    drive.instance,
    projet,
    { version, nomWord, docx: Buffer.from(fichier) },
    drive.deps,
  );
}

// Envoie sur Drive le Word affiché, resté dans l'OS parce que Drive n'était pas prêt à l'import (API
// non activée, compte non reconnecté, écritures réelles désactivées) : il devient un Google Doc.
export async function renvoyerRapportSurDrive(
  db: Executor,
  instance: Instance,
  id: string,
  deps: DriveDeps,
): Promise<ProjetVue> {
  verifierEspace(instance);
  return withInstance(db, instance.id, async (tx) => {
    const [projet] = await tx
      .select()
      .from(diagnosticProjets)
      .where(and(eq(diagnosticProjets.id, id), eq(diagnosticProjets.instanceId, instance.id)));
    if (!projet) throw new ProjetIntrouvable('Projet introuvable dans cette instance');
    if (!projet.rapport || !projet.rapportNom)
      throw new ChatIndisponible('Aucun rapport à envoyer sur Drive.');
    if (projet.rapportLienStatut === 'en_cours')
      throw new ChatIndisponible('Un rapport est en cours de rédaction : attendez sa fin.');
    const version = Math.max(
      projet.rapportVersions.at(-1)?.version ?? 0,
      versionDuNom(projet.rapportNom),
    );
    if (projet.rapportLiens.some((l) => l.version === version))
      throw new ChatIndisponible(`La version ${version} est déjà sur Drive.`);
    const envoi = await envoyerRapportSurDrive(
      tx,
      instance,
      projet,
      { version, nomWord: projet.rapportNom, docx: Buffer.from(projet.rapport, 'base64') },
      deps,
    );
    if (envoi.statut === 'indisponible')
      throw new ChatIndisponible(
        'Drive n’est pas connecté : reconnectez le compte Google dans Paramètres > Connexions.',
      );
    if (envoi.statut === 'simulation')
      throw new ChatIndisponible('Écritures réelles désactivées : rien n’a été envoyé sur Drive.');
    if (envoi.statut === 'erreur')
      throw new ChatIndisponible(`Drive a refusé l’envoi : ${envoi.message ?? 'erreur inconnue'}`);
    const [apres] = await tx.select().from(diagnosticProjets).where(eq(diagnosticProjets.id, id));
    return vue(apres!);
  });
}

const WORD_MAX = 10 * 1024 * 1024;

// Marc retravaille le rapport hors de l'OS : sa version remplace le Word affiché (ses versions
// rédigées par Claude restent téléchargeables) et la production suivante part de son numéro.
export async function importerRapport(
  db: Executor,
  instance: Instance,
  id: string,
  word: { nom: string; base64: string },
  deps?: DriveDeps,
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
    // Sa version devient un Google Doc comme les autres : le lien du rapport pointe dessus.
    if (deps) {
      await envoyerRapportSurDrive(
        tx,
        instance,
        row!,
        { version: versionDuNom(word.nom), nomWord: row!.rapportNom ?? word.nom, docx: octets },
        deps,
      );
      const [apres] = await tx.select().from(diagnosticProjets).where(eq(diagnosticProjets.id, id));
      return vue(apres!);
    }
    return vue(row!);
  });
}
