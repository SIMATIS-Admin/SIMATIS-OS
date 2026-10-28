import { eq } from 'drizzle-orm';
import { creerDossier, envoyerEnDoc, exporterDocx } from '../connecteurs/google/google.js';
import { DRIVE_SCOPE, scopeAccorde, type FetchLike } from '../connecteurs/google/oauth.js';
import type { SyncCtx } from '../connexions/types.js';
import type { Executor, Tx } from '../db.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { logEvent } from '../journal/service.js';
import { canWriteReal } from '../propositions/service.js';
import { loadInstanceSecrets } from '../secrets.js';
import { diagnosticProjets, type Projet } from './schema.js';
import { ProjetIntrouvable, verifierEspace } from './service.js';
import { nomFichier } from './rapport-word.js';

export type DriveDeps = { secretsDir: string; realWrites: boolean; fetch?: FetchLike };

// 'indisponible' : Google ou son accès Drive n'est pas branché (le rapport reste dans l'OS).
// 'simulation' : écritures réelles désactivées. 'erreur' : Drive a refusé, le rapport est gardé.
export type EnvoiDrive = {
  statut: 'ok' | 'simulation' | 'indisponible' | 'erreur';
  lien?: string;
  message?: string;
};

const IDENTIFIANT_DOC = /\/document\/d\/([\w-]+)/;
export const estGoogleDoc = (lien: string | null) => !!lien && IDENTIFIANT_DOC.test(lien);

// Envoie une version du rapport (le Word de l'OS) dans le dossier Drive du diagnostic, où Drive le
// convertit en Google Doc. Le Doc devient la référence : le lien courant pointe sur lui. Un échec
// de Drive ne fait jamais perdre le rapport, qui reste enregistré dans le projet.
export async function envoyerRapportSurDrive(
  tx: Tx,
  instance: Instance,
  projet: Pick<Projet, 'id' | 'nom' | 'driveDossierId' | 'rapportLiens'>,
  { version, nomWord, docx }: { version: number; nomWord: string; docx: Buffer },
  deps: DriveDeps,
): Promise<EnvoiDrive> {
  const secrets = await loadInstanceSecrets(deps.secretsDir, instance.slug);
  if (!secrets.GOOGLE_REFRESH_TOKEN || !scopeAccorde(secrets.GOOGLE_SCOPE, DRIVE_SCOPE)) {
    return { statut: 'indisponible' };
  }
  const ctx: SyncCtx = {
    instance,
    tx,
    secrets,
    reglages: {},
    connexionId: '',
    derniereSynchro: null,
    reel: canWriteReal(instance, deps.realWrites),
  };
  const options = { ...(deps.fetch ? { fetch: deps.fetch } : {}) };
  // The browser's « (1) » (a file saved twice) has no place in the Doc's name.
  const nom = nomWord.replace(/\.docx$/i, '').replace(/\s*\(\d+\)$/, '');
  try {
    let dossierId = projet.driveDossierId ?? undefined;
    // Without real writes nothing is created: the Doc upload alone logs the simulation.
    if (!dossierId && ctx.reel) {
      dossierId = (await creerDossier(ctx, `Diagnostic - ${projet.nom}`, undefined, options))
        .fichier?.id;
    }
    const envoi = await envoyerEnDoc(ctx, { nom, docx, dossierId }, options);
    if (envoi.simulation || !envoi.fichier?.lien) return { statut: 'simulation' };
    const le = new Date().toISOString();
    await tx
      .update(diagnosticProjets)
      .set({
        driveDossierId: dossierId ?? null,
        rapportLien: envoi.fichier.lien,
        rapportLiens: [{ lien: envoi.fichier.lien, le, version }, ...projet.rapportLiens],
      })
      .where(eq(diagnosticProjets.id, projet.id));
    return { statut: 'ok', lien: envoi.fichier.lien };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logEvent(tx, {
      acteur: 'os',
      action: `Rapport non envoyé sur Drive (${nom}) : ${message}`,
    });
    return { statut: 'erreur', message };
  }
}

// La version courante du Doc, ou celle d'un numéro : exportée en Word par Drive, donc avec les
// retouches faites à la main dans Google Docs.
export async function exporterRapportDrive(
  db: Executor,
  instance: Instance,
  id: string,
  deps: DriveDeps,
  version?: number,
): Promise<{ nom: string; contenu: Buffer }> {
  verifierEspace(instance);
  const projet = await withInstance(db, instance.id, async (tx) => {
    const [row] = await tx
      .select({
        nom: diagnosticProjets.nom,
        nomWord: diagnosticProjets.rapportNom,
        lien: diagnosticProjets.rapportLien,
        liens: diagnosticProjets.rapportLiens,
      })
      .from(diagnosticProjets)
      .where(eq(diagnosticProjets.id, id));
    return row;
  });
  if (!projet) throw new ProjetIntrouvable('Projet introuvable dans cette instance');
  const entree =
    version === undefined
      ? projet.liens.find((l) => l.lien === projet.lien)
      : projet.liens.find((l) => l.version === version);
  const lien = version === undefined ? projet.lien : entree?.lien;
  const docId = lien ? IDENTIFIANT_DOC.exec(lien)?.[1] : undefined;
  if (!docId) throw new ProjetIntrouvable('Aucun Google Doc pour cette version du rapport');
  const secrets = await loadInstanceSecrets(deps.secretsDir, instance.slug);
  const contenu = await exporterDocx(
    { secrets, instance },
    docId,
    deps.fetch ? { fetch: deps.fetch } : {},
  );
  const nom =
    version === undefined && projet.nomWord
      ? projet.nomWord
      : nomFichier(projet.nom, entree?.version ?? version ?? 1);
  return { nom, contenu };
}
