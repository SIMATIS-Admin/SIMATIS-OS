import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { contacts, rdvContacts } from '../crm/schema.js';
import { currentInstance } from '../db/columns.js';
import { registerPropositionType } from '../propositions/registry.js';
import { creerRendezVousDansTx, rdvOsSchema } from './rdv.js';

// Rendez-vous proposé par la routine à partir d'une réponse qui accepte un créneau. Il n'existe
// dans l'OS (et dans l'agenda Google, si l'écriture réelle est permise) qu'une fois validé.
export const rdvCreer = z
  .object({
    titre: z.string().trim().min(1).max(300),
    debut: rdvOsSchema.shape.debut,
    dureeMinutes: z.number().int().min(5).max(1440).default(60),
    lieu: z.string().trim().max(300).nullish(),
    contactId: z.uuid().nullish(),
    origine: z.string().max(200).nullish(),
  })
  .strict();

registerPropositionType({
  type: 'rdv.creer',
  action: 'rdv',
  schema: rdvCreer,
  apply: async (tx, c, ctx) => {
    if (c.contactId) {
      const [contact] = await tx
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.instanceId, currentInstance), eq(contacts.id, c.contactId)));
      if (!contact) throw new Error('Contact introuvable dans cet espace');
    }
    const rdv = await creerRendezVousDansTx(
      tx,
      ctx.instance,
      { titre: c.titre, debut: c.debut, dureeMinutes: c.dureeMinutes, lieu: c.lieu },
      ctx.deps,
    );
    if (c.contactId) {
      await tx
        .insert(rdvContacts)
        .values({ instanceId: currentInstance, rendezVousId: rdv.ligneId, contactId: c.contactId });
    }
    return { id: rdv.id, google: rdv.google };
  },
});
