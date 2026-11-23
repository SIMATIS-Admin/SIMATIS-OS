import { z } from 'zod';
import { registerTool } from '../mcp/tools.js';
import { enregistrerMessage, messagesALire } from './linkedin.js';

// Outils de la routine « Messages LinkedIn » : elle lit dans le Chrome du pilote le texte des
// messages dont l'OS a reçu la notification, et le range dans l'entrée de l'Inbox.

const execution = z.uuid().optional().describe("Identifiant de l'exécution de routine en cours");

registerTool({
  name: 'messages_linkedin_a_lire',
  description:
    "Entrées LinkedIn de l'Inbox dont le texte complet n'a pas été lu (au plus cinq, les plus anciennes d'abord) : identifiant, titre (« Message LinkedIn de … » quand l'objet du mail nommait l'expéditeur), aperçu du mail et `recuLe` (heure d'arrivée du mail de notification : le message à lire a été reçu juste avant, lu ou non). Liste vide : rien à lire, ne pas ouvrir LinkedIn.",
  input: z.object({ executionId: execution }),
  scope: 'instance',
  handler: async ({ tx }) => ({ messages: await messagesALire(tx) }),
});

registerTool({
  name: 'enregistrer_message_linkedin',
  description:
    "Range dans l'entrée le texte du message lu sur LinkedIn (texte brut, sans mise en forme) et le nom de l'expéditeur tel qu'affiché. Si la conversation reste introuvable sur LinkedIn, appelle l'outil sans texte : l'aperçu est gardé et l'entrée n'est plus proposée. La réponse « introuvable » est normale (entrée traitée entre-temps) : ne rien faire de plus.",
  input: z.object({
    id: z.uuid(),
    texte: z.string().max(20_000).optional(),
    expediteur: z.string().max(200).optional(),
    executionId: execution,
  }),
  scope: 'instance',
  handler: async ({ tx }, { id, texte, expediteur }) => ({
    statut: await enregistrerMessage(tx, id, {
      ...(texte ? { texte } : {}),
      ...(expediteur ? { expediteur } : {}),
    }),
  }),
});
