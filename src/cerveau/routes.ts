import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db.js';
import { getInstanceBySlug } from '../instances/service.js';
import { resolveToken } from '../mcp/tokens.js';
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

export function registerCerveauRoutes(app: FastifyInstance, { db }: { db: Database }): void {
  // Le runner du poste lit le dossier du second cerveau et en dépose la carte.
  app.post<{ Body: unknown }>('/api/runner/cerveau/carte', async (request, reply) => {
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const resolved = token ? await resolveToken(db, token) : null;
    if (resolved?.jeton.portee !== 'runner')
      return reply.code(401).send({ error: "Jeton d'exécuteur invalide" });
    const parsed = carteSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Carte invalide' });
    deposerCarte(parsed.data);
    return { ok: true };
  });

  // Réservé aux espaces SIMATIS qui ont le module : jamais une démo, qui ne doit rien voir du vrai.
  app.get<{ Params: { slug: string } }>('/api/i/:slug/cerveau/carte', async (request, reply) => {
    const instance = await getInstanceBySlug(db, request.params.slug);
    if (!instance) return reply.code(404).send({ error: 'Instance inconnue' });
    if (instance.type !== 'propre' || !(instance.config.modules ?? []).includes('cerveau'))
      return reply.code(403).send({ error: "Le second cerveau n'est pas activé dans cet espace." });
    return lireCarte();
  });
}
