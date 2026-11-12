import { and, eq, isNull } from 'drizzle-orm';
import type { ConnexionDeps } from '../connexions/service.js';
import type { Executor } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { ChangementInvalide, createOpportunite, pipelineSource } from './pipeline.js';
import { contacts, entreprises, opportunites } from './schema.js';

// Un prospect qui a obtenu un rendez-vous entre dans le Pipeline : une affaire à la première étape,
// titrée par son entreprise (à défaut par son nom) et reliée à lui. Comme toute affaire créée dans
// l'OS : dans HubSpot d'abord quand l'espace en a un (simulée si l'écriture réelle est fermée).
export async function creerAffairePourContact(
  db: Executor,
  instance: Instance,
  contactId: string,
  deps: ConnexionDeps,
) {
  const prepare = await withInstance(db, instance.id, async (tx) => {
    const [contact] = await tx
      .select({
        nom: contacts.nom,
        entrepriseId: contacts.entrepriseId,
        entreprise: entreprises.nom,
      })
      .from(contacts)
      .leftJoin(entreprises, eq(entreprises.id, contacts.entrepriseId))
      .where(and(eq(contacts.instanceId, currentInstance), eq(contacts.id, contactId)));
    if (!contact) throw new ChangementInvalide('Contact introuvable dans cette instance');
    const [ouverte] = await tx
      .select({ id: opportunites.id })
      .from(opportunites)
      .where(
        and(
          eq(opportunites.instanceId, currentInstance),
          eq(opportunites.contactId, contactId),
          isNull(opportunites.clos),
        ),
      )
      .limit(1);
    if (ouverte) throw new ChangementInvalide('Ce contact a déjà une affaire ouverte.');
    const etape = (await pipelineSource(tx)).etapes[0]?.id;
    if (!etape) throw new ChangementInvalide('Le Pipeline n’a aucune étape ouverte.');
    return { contact, etape };
  });
  return createOpportunite(
    db,
    instance,
    {
      titre: prepare.contact.entreprise ?? prepare.contact.nom,
      etape: prepare.etape,
      contactId,
      entrepriseId: prepare.contact.entrepriseId,
    },
    deps,
  );
}
