import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db.js';
import { getInstanceBySlug } from '../instances/service.js';
import { resolveToken } from '../mcp/tokens.js';
import { demander, prendre, repondre, RunnerInjoignable } from './file.js';
import { deposerCarte, lireCarte } from './store.js';

const carteSchema = z.object({
  noeuds: z
    .array(
      z.object({
        id: z.string().max(500),
        titre: z.string().max(500),
        categorie: z.string().max(100),
        statut: z.string().max(50).nullable(),
      }),
    )
    .max(10_000),
  liens: z.array(z.object({ de: z.string().max(500), vers: z.string().max(500) })).max(100_000),
  autresFichiers: z.number().int().min(0),
  tronquee: z.boolean(),
});

const operationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('lire'), chemin: z.string().max(300) }),
  z.object({
    type: z.literal('ecrire'),
    chemin: z.string().max(300),
    contenu: z.string().max(500_000),
    empreinte: z.string().max(100),
  }),
  z.object({
    type: z.literal('ajouter'),
    titre: z.string().trim().min(1).max(200),
    texte: z.string().max(500_000),
  }),
]);

const resultatSchema = z.union([
  z.object({
    ok: z.literal(true),
    chemin: z.string().optional(),
    contenu: z.string().optional(),
    empreinte: z.string().optional(),
  }),
  z.object({ ok: z.literal(false), erreur: z.string().max(1000), conflit: z.boolean().optional() }),
]);

export function registerCerveauRoutes(app: FastifyInstance, { db }: { db: Database }): void {
  const estRunner = async (request: FastifyRequest) => {
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const resolved = token ? await resolveToken(db, token) : null;
    return resolved?.jeton.portee === 'runner';
  };
  const refus = (reply: FastifyReply) =>
    reply.code(401).send({ error: "Jeton d'exécuteur invalide" });

  // Le runner du poste lit le dossier du second cerveau et en dépose la carte.
  app.post<{ Body: unknown }>('/api/runner/cerveau/carte', async (request, reply) => {
    if (!(await estRunner(request))) return refus(reply);
    const parsed = carteSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Carte invalide' });
    deposerCarte(parsed.data);
    return { ok: true };
  });

  // Réservé aux espaces SIMATIS qui ont le module : jamais une démo, qui ne doit rien voir du vrai.
  const acces = async (slug: string, reply: FastifyReply) => {
    const instance = await getInstanceBySlug(db, slug);
    if (!instance) return reply.code(404).send({ error: 'Instance inconnue' });
    if (instance.type !== 'propre' || !(instance.config.modules ?? []).includes('cerveau'))
      return reply.code(403).send({ error: "Le second cerveau n'est pas activé dans cet espace." });
    return null;
  };

  app.get<{ Params: { slug: string } }>('/api/i/:slug/cerveau/carte', async (request, reply) => {
    const refuse = await acces(request.params.slug, reply);
    return refuse ?? lireCarte();
  });

  // Lire, enregistrer une note ou ajouter une idée : exécuté par le runner, sur le dossier du Drive.
  app.post<{ Params: { slug: string }; Body: unknown }>(
    '/api/i/:slug/cerveau/operations',
    async (request, reply) => {
      const refuse = await acces(request.params.slug, reply);
      if (refuse) return refuse;
      const parsed = operationSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Demande invalide' });
      try {
        const resultat = await demander(parsed.data);
        if (resultat.ok) return resultat;
        return reply.code(resultat.conflit ? 409 : 400).send({ error: resultat.erreur });
      } catch (e) {
        if (e instanceof RunnerInjoignable)
          return reply.code(504).send({
            error:
              "L'exécuteur de l'ordinateur ne répond pas : vérifiez qu'il tourne (Routines Claude) et que le Drive est synchronisé.",
          });
        throw e;
      }
    },
  );

  app.get('/api/runner/cerveau/operations', async (request, reply) => {
    if (!(await estRunner(request))) return refus(reply);
    return prendre();
  });

  app.post<{ Params: { id: string }; Body: unknown }>(
    '/api/runner/cerveau/operations/:id',
    async (request, reply) => {
      if (!(await estRunner(request))) return refus(reply);
      const parsed = resultatSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Résultat invalide' });
      return { ok: repondre(request.params.id, parsed.data) };
    },
  );
}
