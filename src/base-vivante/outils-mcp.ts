import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { currentInstance } from '../db/columns.js';
import { registerTool } from '../mcp/tools.js';
import { CHAMPS_CIBLES } from './colonnes.js';
import { CLASSES, proposerClasse, reponsesAClasser } from './reponses.js';
import { baseImports, baseLignesBrutes } from './schema.js';
import { completerLigne, reglerCorrespondance } from './service.js';

// Tools of the « Base vivante » routine. Claude works in the airlock only: it reads a sample of
// each import (never the whole file), proposes a column mapping, completes flagged lines and
// proposes a class for each reply. Nothing here writes in the living base or in a CRM, and the
// pilot validates before anything moves.

const execution = z.uuid().optional().describe("Identifiant de l'exécution de routine en cours");
const ECHANTILLON = 30;
const EXEMPLES = 5;

registerTool({
  name: 'base_imports_a_traiter',
  description:
    'Imports de la base vivante en attente de validation ou avec des lignes sous le minimum : fichier, feuille, en-têtes, correspondance actuelle des colonnes, colonnes non reconnues avec quelques exemples, compteurs. Jamais le fichier entier.',
  input: z.object({ executionId: execution }),
  scope: 'instance',
  handler: async ({ tx, instance }) => {
    const imports = await tx
      .select()
      .from(baseImports)
      .where(eq(baseImports.instanceId, currentInstance))
      .orderBy(asc(baseImports.createdAt))
      .limit(50);
    const resultat = [];
    for (const imp of imports) {
      const lignes = await tx
        .select({ brut: baseLignesBrutes.brut, statut: baseLignesBrutes.statut })
        .from(baseLignesBrutes)
        .where(eq(baseLignesBrutes.importId, imp.id))
        .orderBy(asc(baseLignesBrutes.numero))
        .limit(ECHANTILLON);
      const retenues = new Set(Object.values(imp.correspondance));
      const sousMinimum = lignes.filter((l) => l.statut === 'sous_minimum').length;
      if (imp.statut === 'integre' && sousMinimum === 0) continue;
      resultat.push({
        importId: imp.id,
        fichier: imp.nomFichier,
        feuille: imp.feuille,
        provenance: imp.provenance,
        statut: imp.statut,
        entetes: imp.entetes,
        correspondance: imp.correspondance,
        champsPossibles: CHAMPS_CIBLES,
        colonnesNonReconnues: imp.entetes
          .map((entete, index) => ({
            index,
            entete,
            exemples: [...new Set(lignes.map((l) => l.brut[index] ?? '').filter(Boolean))].slice(
              0,
              EXEMPLES,
            ),
          }))
          .filter((c) => !retenues.has(c.index)),
        lignesSousLeMinimumDansLEchantillon: sousMinimum,
      });
    }
    return { instance: instance.nom, imports: resultat };
  },
});

registerTool({
  name: 'base_proposer_correspondance',
  description:
    "Fixe la correspondance des colonnes d'un import encore à l'aperçu : champ → index de colonne (null pour ne pas utiliser un champ). Toutes les lignes sont relues ; rien n'entre dans la base, le pilote valide l'aperçu.",
  input: z.object({
    importId: z.uuid(),
    correspondance: z.record(z.enum(CHAMPS_CIBLES), z.number().int().min(0).nullable()),
    executionId: execution,
  }),
  scope: 'instance',
  handler: async ({ tx, instance }, { importId, correspondance }) => {
    const apercu = await reglerCorrespondance(tx, instance.id, importId, correspondance, false);
    return { correspondance: apercu.correspondance, compteurs: apercu.compteurs };
  },
});

registerTool({
  name: 'base_lignes_signalees',
  description:
    "Lignes d'un import à regarder : sous le minimum (entreprise ou nom manquant, avec la raison) ou prêtes mais avec un avertissement (email ou téléphone invalide). Au plus 50 lignes, avec leur contenu brut.",
  input: z.object({
    importId: z.uuid(),
    statut: z.enum(['sous_minimum', 'pret']).default('sous_minimum'),
    limite: z.number().int().min(1).max(50).default(30),
    executionId: execution,
  }),
  scope: 'instance',
  handler: async ({ tx }, { importId, statut, limite }) => {
    const lignes = await tx
      .select()
      .from(baseLignesBrutes)
      .where(
        and(
          eq(baseLignesBrutes.instanceId, currentInstance),
          eq(baseLignesBrutes.importId, importId),
          eq(baseLignesBrutes.statut, statut),
        ),
      )
      .orderBy(asc(baseLignesBrutes.numero))
      .limit(statut === 'pret' ? 500 : limite);
    return lignes
      .filter((l) => statut === 'sous_minimum' || l.avertissements.length > 0)
      .slice(0, limite)
      .map((l) => ({
        numero: l.numero,
        brut: l.brut,
        raison: l.raison,
        avertissements: l.avertissements,
        fiche: l.fiche,
      }));
  },
});

registerTool({
  name: 'base_corriger_ligne',
  description:
    "Complète ou corrige une ligne du sas (celle d'un import) : entreprise, prénom, nom, email, téléphone, fonction. La ligne est normalisée et reclassée ; elle n'entre dans la base qu'à l'intégration validée par le pilote.",
  input: z.object({
    importId: z.uuid(),
    numero: z.number().int().min(1),
    entreprise: z.string().max(200).optional(),
    prenom: z.string().max(120).optional(),
    nom: z.string().max(120).optional(),
    email: z.string().max(200).optional(),
    telephone: z.string().max(60).optional(),
    fonction: z.string().max(200).optional(),
    executionId: execution,
  }),
  scope: 'instance',
  handler: async ({ tx, instance }, input) => {
    const { importId, numero, entreprise, prenom, nom, email, telephone, fonction } = input;
    const ligne = await completerLigne(tx, instance.id, importId, numero, {
      entreprise,
      prenom,
      nom,
      email,
      telephone,
      fonction,
    });
    return { numero: ligne.numero, statut: ligne.statut, zone: ligne.zone, raison: ligne.raison };
  },
});

registerTool({
  name: 'base_reponses_a_classer',
  description:
    "Réponses reçues d'un mandat (extrait de quelques lignes) qui attendent d'être classées : intéressé, pas intéressé, « ne plus me contacter », mauvais interlocuteur, réponse automatique. Les réponses automatiques sont déjà classées.",
  input: z.object({
    limite: z.number().int().min(1).max(50).default(30),
    executionId: execution,
  }),
  scope: 'instance',
  handler: async ({ tx, instance }, { limite }) =>
    (await reponsesAClasser(tx, instance.id, limite)).map((r) => ({
      reponseId: r.id,
      entreprise: r.entreprise,
      contact: r.contact,
      mandat: r.mandat,
      recuLe: r.recuLe.toISOString(),
      objet: r.objet,
      extrait: r.extrait,
    })),
});

registerTool({
  name: 'base_classer_reponse',
  description:
    "Propose la classe d'une réponse. « ne_plus_contacter » est prioritaire : à utiliser dès que l'interlocuteur demande à ne plus être contacté. La fiche ne bouge qu'à la validation du pilote.",
  input: z.object({
    reponseId: z.uuid(),
    classe: z.enum(CLASSES),
    executionId: execution,
  }),
  scope: 'instance',
  handler: async ({ tx, instance }, { reponseId, classe }) => {
    await proposerClasse(tx, instance.id, reponseId, classe);
    return { reponseId, classe, validee: false };
  },
});
