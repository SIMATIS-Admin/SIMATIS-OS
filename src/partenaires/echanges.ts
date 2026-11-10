import { deposer, messageLibre } from 'os-agents-relay';
import { and, eq } from 'drizzle-orm';
import type { Executor } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { logEvent } from '../journal/service.js';
import { canWriteReal } from '../propositions/service.js';
import { messagesPartenaires, type TypeMessage } from './schema.js';
import { estEchange, listerPartenaires, nomCourt } from './service.js';

export { estEchange };
import { stockageTx } from './stockage.js';

// Un message de l'espace partagé et son envoi par le relais sont le même message : l'identifiant
// du message relayé EST le chemin du fichier déposé dans echanges/. Chaque côté reconnaît ainsi
// ce qu'il a déjà, qu'il l'ait reçu par le kDrive, par le relais ou par les deux.

export type MiroirResultat =
  | { statut: 'envoye' | 'simulation' | 'deja'; partenaire: string }
  | { statut: 'aucun'; raison: string };

// Marc a déposé un message dans echanges/ : le même part par le relais, pour que l'OS de l'autre le
// reçoive dans son Inbox. L'envoi vient d'un geste de Marc (formulaire ou « Répondre »), il n'attend
// donc pas de validation. Un seul partenaire actif, ou à défaut celui dont le nom évoque Alpes.
export async function miroirVersRelais(
  db: Executor,
  instance: Instance,
  realWrites: boolean,
  m: {
    genre: TypeMessage;
    sujet: string;
    corps: string;
    enReponseA?: string | undefined;
    chemin: string;
  },
): Promise<MiroirResultat> {
  return withInstance(db, instance.id, async (tx): Promise<MiroirResultat> => {
    const actifs = (await listerPartenaires(tx)).filter((p) => p.statut === 'active');
    const p = actifs.length === 1 ? actifs[0] : actifs.find((a) => /alpes|alpia/i.test(a.nom));
    if (!p) {
      return {
        statut: 'aucun',
        raison: actifs.length ? 'Plusieurs partenaires actifs' : 'Aucun partenaire connecté',
      };
    }
    // Une seconde demande pour le même fichier ne renvoie rien.
    const [deja] = await tx
      .select({ id: messagesPartenaires.id })
      .from(messagesPartenaires)
      .where(
        and(
          eq(messagesPartenaires.instanceId, currentInstance),
          eq(messagesPartenaires.id, m.chemin),
        ),
      );
    if (deja) return { statut: 'deja', partenaire: p.nom };

    const msg = messageLibre({
      type: m.genre,
      sujet: m.sujet,
      texte: m.corps,
      ...(m.enReponseA ? { en_reponse_a: m.enReponseA } : {}),
    });
    msg.messageId = m.chemin;
    const reel = canWriteReal(instance, realWrites);
    const sortie = reel
      ? await deposer({
          stockage: stockageTx(tx),
          connexion: p.connexionId,
          type: 'message',
          corps: msg,
        })
      : null;
    await tx.insert(messagesPartenaires).values({
      id: m.chemin,
      instanceId: currentInstance,
      partenaireId: p.id,
      sens: 'envoye',
      type: m.genre,
      sujet: m.sujet,
      texte: m.corps,
      enReponseA: m.enReponseA ?? null,
      simulation: !reel,
      envoyePar: 'pilote',
    });
    await logEvent(tx, {
      acteur: 'pilote',
      action: `Message à ${nomCourt(p.nom)}${reel ? '' : ' (simulation)'} : ${m.sujet}`,
      details: { message: m.chemin, ...(sortie ? { enveloppe: sortie.id } : {}) },
    });
    return { statut: reel ? 'envoye' : 'simulation', partenaire: p.nom };
  });
}

// Les messages échangés par le relais, en nœuds de l'écran Échanges. Un message qui a son fichier
// dans echanges/ porte le même identifiant que lui : l'appelant garde alors celui du kDrive. Les
// autres (sans fichier) portent leur texte, que le kDrive ne peut pas fournir.
export async function messagesRelayes(db: Executor, instance: Instance, moi: string) {
  const rows = await withInstance(db, instance.id, async (tx) => {
    const noms = new Map((await listerPartenaires(tx)).map((p) => [p.id, nomCourt(p.nom)]));
    const messages = await tx
      .select()
      .from(messagesPartenaires)
      .where(eq(messagesPartenaires.instanceId, currentInstance));
    return messages.map((m) => ({ m, nom: noms.get(m.partenaireId) ?? 'partenaire' }));
  });
  return rows.map(({ m, nom }) => {
    const date = m.createdAt.toISOString();
    const id = estEchange(m.id)
      ? m.id
      : `echanges/${date.slice(0, 10)}-${date.slice(11, 16).replace(':', '')}-${m.id.slice(0, 8)}-relais.md`;
    return {
      id,
      titre: m.sujet,
      categorie: 'echanges',
      statut: null,
      genre: m.type,
      // Dans l'espace partagé, l'auteur côté Alpes est Christophe.
      auteur:
        m.sens === 'envoye' ? moi : /alpes|alpia/i.test(nom) ? 'christophe' : nom.toLowerCase(),
      date,
      reponseA: m.enReponseA && estEchange(m.enReponseA) ? m.enReponseA : null,
      texte: m.texte,
    };
  });
}
