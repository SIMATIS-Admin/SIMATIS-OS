import { z } from 'zod';
import { registerTool } from '../mcp/tools.js';
import { RESULTATS_ENVOI, rapporterEnvoi, recupererEnvoi } from './envois.js';

// Outils de la routine « Envoi SalesNav » : elle prend la demande de connexion préparée par le
// pilote, la fait dans son Chrome, puis rapporte ce qu'elle a vu.

const execution = z.uuid().optional().describe("Identifiant de l'exécution de routine en cours");

registerTool({
  name: 'salesnav_envoi_a_faire',
  description:
    "Prend la demande de connexion Sales Navigator validée par le pilote : identifiant, nom attendu, lien du profil, note d'invitation exacte, et `essaiABlanc` (vrai : tout faire SAUF le clic final « Envoyer »). Renvoie `envoi: null` quand rien n'est à faire : ne rien ouvrir.",
  input: z.object({ executionId: execution }),
  scope: 'instance',
  handler: async ({ tx }) => ({ envoi: await recupererEnvoi(tx) }),
});

registerTool({
  name: 'salesnav_envoi_rapport',
  description:
    "Rapporte le résultat de la demande : envoye (invitation partie), deja_connecte, invitation_en_attente, nom_different (le profil ouvert n'est pas la bonne personne : ne rien envoyer), introuvable, avertissement (LinkedIn affiche un avertissement ou une limite : l'OS met le canal en pause), echec. Précise en `detail` ce qui est affiché à l'écran.",
  input: z.object({
    id: z.uuid(),
    resultat: z.enum(RESULTATS_ENVOI),
    detail: z.string().max(500).optional(),
    executionId: execution,
  }),
  scope: 'instance',
  handler: async ({ tx }, { id, resultat, detail }) => {
    const envoi = await rapporterEnvoi(tx, id, resultat, detail);
    return { statut: envoi.statut };
  },
});
