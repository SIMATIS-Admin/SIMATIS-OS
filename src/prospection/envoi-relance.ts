import { and, eq } from 'drizzle-orm';
import { writeVia, type ConnexionDeps } from '../connexions/service.js';
import type { Database } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { echapper } from '../mail/gabarit.js';
import { CampagneInvalide } from './campagnes.js';
import { prospectionSignatures } from './schema.js';

export type MailRelance = {
  to: string;
  objet: string;
  corps: string;
  signatureId: string | null;
  threadId?: string;
  // Brouillon dans la messagerie, ou envoi direct.
  mode: 'brouillon' | 'envoi';
};
export type ResultatMailRelance = { simulation: boolean };

const ADRESSE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

// Le texte tapé par Marc devient du HTML : jamais de balise venue du texte, un paragraphe par bloc.
export function texteEnHtml(texte: string): string {
  return texte
    .replace(/\r\n/g, '\n')
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p>${echapper(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

// Un mail d'une action de relance, écrit dans la messagerie de l'instance avec la signature choisie
// (image). Les écritures réelles gardent leur double verrou : fermées, rien ne part et le résultat
// le dit, pour que l'écran ne clôture pas l'action.
export async function envoyerMailRelance(
  db: Database,
  instance: Instance,
  mail: MailRelance,
  deps: ConnexionDeps,
): Promise<ResultatMailRelance> {
  if (!ADRESSE.test(mail.to)) throw new CampagneInvalide('Adresse du destinataire invalide.');
  if (!mail.objet.trim()) throw new CampagneInvalide("Indiquez l'objet du mail.");
  if (!mail.corps.trim()) throw new CampagneInvalide('Le mail est vide.');
  return withInstance(db, instance.id, async (tx) => {
    const [signature] = mail.signatureId
      ? await tx
          .select()
          .from(prospectionSignatures)
          .where(
            and(
              eq(prospectionSignatures.instanceId, currentInstance),
              eq(prospectionSignatures.id, mail.signatureId),
            ),
          )
      : [];
    if (mail.signatureId && !signature) throw new CampagneInvalide('Signature introuvable.');
    const images = signature
      ? [{ cid: 'signature', typeMime: signature.typeMime, base64: signature.image }]
      : [];
    const r = await writeVia(
      tx,
      instance,
      'messagerie',
      {
        op: mail.mode === 'envoi' ? 'message.send' : 'draft.create',
        data: {
          to: mail.to,
          subject: mail.objet.trim(),
          html: `${texteEnHtml(mail.corps)}${images.length ? '<p><img src="cid:signature" alt="Signature" style="max-width:480px"></p>' : ''}`,
          ...(images.length ? { images } : {}),
          ...(mail.threadId ? { threadId: mail.threadId } : {}),
        },
      },
      deps,
    );
    return { simulation: !!r.simulation };
  });
}
