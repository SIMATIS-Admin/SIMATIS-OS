import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db.js';
import { getInstanceBySlug } from '../instances/service.js';
import { CopieDejaFaite, executerTransfert } from './executer.js';
import { peutTransferer, UTILISATEUR_PILOTE } from './droits.js';
import { planifierTransfert, RacineIntrouvable, TransfertRefuse } from './plan.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPE = z.enum(['sujet', 'tache', 'affaire', 'contact', 'entreprise', 'rdv']);
const REF = z.object({ type: TYPE, id: z.string().regex(UUID) });
const corpsSchema = REF.extend({
  instanceOrigine: z.string().min(1),
  instanceCible: z.string().min(1),
  exclusions: z.array(REF).default([]),
  copierQuandMeme: z.boolean().optional(),
});

type Params = { Params: { slug: string } };

// `db` reads instances (not isolated). `transfertDb` is an owner connection: a transfer touches two
// instances in one transaction, which Row-Level Security forbids to the app role. Only these
// routes use it, and only for the super administrator viewing the own instance.
export function registerTransfertRoutes(
  app: FastifyInstance,
  { db, transfertDb }: { db: Database; transfertDb: Database },
) {
  app.get<Params>('/api/i/:slug/transfert/droit', async (request, reply) => {
    const instance = await getInstanceBySlug(db, request.params.slug);
    if (!instance) return reply.code(404).send({ error: 'Instance inconnue' });
    return { autorise: peutTransferer(UTILISATEUR_PILOTE, instance) };
  });

  const agir =
    (action: 'apercu' | 'executer') =>
    async (request: { params: { slug: string }; body: unknown }, reply: FastifyReply) => {
      const courante = await getInstanceBySlug(db, request.params.slug);
      if (!courante) return reply.code(404).send({ error: 'Instance inconnue' });
      if (!peutTransferer(UTILISATEUR_PILOTE, courante)) {
        return reply.code(403).send({ error: 'Transfert réservé à l’instance SIMATIS.' });
      }
      const corps = corpsSchema.safeParse(request.body);
      if (!corps.success) {
        return reply
          .code(400)
          .send({ error: corps.error.issues[0]?.message ?? 'Requête invalide' });
      }
      const { instanceOrigine, instanceCible, copierQuandMeme, ...reste } = corps.data;
      const origine = await getInstanceBySlug(db, instanceOrigine);
      const cible = await getInstanceBySlug(db, instanceCible);
      if (!origine || !cible) return reply.code(404).send({ error: 'Instance inconnue' });
      const demande = {
        instanceOrigine: origine.id,
        cible: cible.id,
        racine: { type: reste.type, id: reste.id },
        exclusions: reste.exclusions,
      };
      try {
        return action === 'apercu'
          ? await planifierTransfert(transfertDb, demande)
          : await executerTransfert(transfertDb, {
              ...demande,
              ...(copierQuandMeme ? { copierQuandMeme } : {}),
            });
      } catch (error) {
        if (error instanceof RacineIntrouvable)
          return reply.code(404).send({ error: error.message });
        if (error instanceof TransfertRefuse) return reply.code(400).send({ error: error.message });
        if (error instanceof CopieDejaFaite) {
          return reply.code(409).send({ error: error.message, noeud: error.noeud });
        }
        if ((error as { cause?: { code?: string } }).cause?.code === '23505') {
          return reply
            .code(409)
            .send({ error: 'Conflit avec un objet déjà présent dans la cible.' });
        }
        throw error;
      }
    };
  app.post<Params>('/api/i/:slug/transfert/apercu', agir('apercu'));
  app.post<Params>('/api/i/:slug/transfert', agir('executer'));
}
