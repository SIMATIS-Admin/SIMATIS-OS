import { and, eq } from 'drizzle-orm';
import type { ConnexionDeps } from '../connexions/service.js';
import type { Database } from '../db.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { envoyerMail, mailRelance, type EnvoiInvitation } from './invitations.js';
import { vmaTests } from './schema.js';

export class RelanceImpossible extends Error {}

// Deux relances à moins d'une minute sont un double clic, pas une seconde relance.
const DOUBLON_MS = 60_000;

// Seul chemin de relance : le bouton et le passage quotidien l'appellent. Le verrou de ligne
// empêche deux relances simultanées. Une simulation ne compte pas ; un échec est consigné.
export async function relancerInvitation(
  db: Database,
  instance: Instance,
  ecriture: ConnexionDeps,
  p: {
    testId: string;
    origine: 'manuelle' | 'auto';
    tutoiement?: boolean;
    maintenant?: Date;
  },
): Promise<EnvoiInvitation> {
  const maintenant = p.maintenant ?? new Date();
  return withInstance(db, instance.id, async (tx) => {
    const [test] = await tx
      .select()
      .from(vmaTests)
      .where(and(eq(vmaTests.instanceId, instance.id), eq(vmaTests.id, p.testId)))
      .for('update');
    if (!test) throw new RelanceImpossible('Invitation introuvable dans cette instance');
    if (test.statut !== 'envoyee')
      throw new RelanceImpossible('Seule une invitation ouverte peut être relancée');
    if (test.expireLe <= maintenant)
      throw new RelanceImpossible('Invitation expirée : créez-en une nouvelle');
    if (!test.contactEmail) throw new RelanceImpossible('Aucune adresse e-mail pour ce contact');
    const derniere = test.relances.at(-1);
    if (derniere && maintenant.getTime() - new Date(derniere.le).getTime() < DOUBLON_MS)
      throw new RelanceImpossible('Relance déjà envoyée à l’instant');

    const tutoiement = p.tutoiement ?? test.tutoiement;
    const envoi = await envoyerMail(tx, instance, ecriture, {
      to: test.contactEmail,
      message: mailRelance({
        entrepriseNom: test.entrepriseNom,
        contactNom: test.contactNom,
        lien: test.lien,
        expireLe: test.expireLe,
        tutoiement,
      }),
    });
    await tx
      .update(vmaTests)
      .set({
        tutoiement,
        updatedAt: new Date(),
        ...(envoi.statut === 'envoye'
          ? {
              relances: [...test.relances, { le: maintenant.toISOString(), origine: p.origine }],
              echecEnvoi: null,
            }
          : {}),
        ...(envoi.statut === 'echec' ? { echecEnvoi: envoi.raison ?? 'échec' } : {}),
      })
      .where(and(eq(vmaTests.instanceId, instance.id), eq(vmaTests.id, test.id)));
    return envoi;
  });
}
