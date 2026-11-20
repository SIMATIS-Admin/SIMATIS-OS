import type { FastifyInstance } from 'fastify';
import type { Database } from '../db.js';
import { getInstanceBySlug } from '../instances/service.js';
import { ouvrirConsole, ouvrirPassation, PassationImpossible } from './passation.js';
import { DiagnosticIndisponible, ProjetIntrouvable } from './service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PassationRoutesDeps = {
  db: Database;
  // Site et jeton OS vers site (VMA_OS_TOKEN) ; null tant que le site n'est pas configuré.
  vma: { url: string; token: string } | null;
  fetch?: typeof fetch;
};

export function registerPassationRoutes(app: FastifyInstance, deps: PassationRoutesDeps) {
  // Accès à la console « Mes diagnostics » sans passer par un projet (bouton du support de présentation).
  app.post<{ Params: { slug: string } }>(
    '/api/i/:slug/diagnostic/console',
    async (request, reply) => {
      const instance = await getInstanceBySlug(deps.db, request.params.slug);
      if (!instance) return reply.code(404).send({ error: 'Instance inconnue' });
      if (instance.type !== 'propre')
        return reply.code(403).send({ error: "Le diagnostic est réservé à l'espace SIMATIS." });
      if (!deps.vma) return reply.code(503).send({ error: 'Site non configuré (VMA_OS_TOKEN)' });
      try {
        return await ouvrirConsole({ ...deps.vma, ...(deps.fetch ? { fetch: deps.fetch } : {}) });
      } catch (error) {
        if (error instanceof PassationImpossible)
          return reply.code(502).send({ error: error.message });
        throw error;
      }
    },
  );

  // « Lancer le diagnostic » : prépare la fiche sur le site et rend le lien de la console, ouverte sur ce projet.
  app.post<{ Params: { slug: string; id: string } }>(
    '/api/i/:slug/diagnostic/projets/:id/passation',
    async (request, reply) => {
      const instance = await getInstanceBySlug(deps.db, request.params.slug);
      if (!instance) return reply.code(404).send({ error: 'Instance inconnue' });
      if (!UUID.test(request.params.id)) return reply.code(400).send({ error: 'Projet invalide' });
      if (!deps.vma) return reply.code(503).send({ error: 'Site non configuré (VMA_OS_TOKEN)' });
      try {
        return await ouvrirPassation(deps.db, instance, request.params.id, {
          ...deps.vma,
          ...(deps.fetch ? { fetch: deps.fetch } : {}),
        });
      } catch (error) {
        if (error instanceof ProjetIntrouvable)
          return reply.code(404).send({ error: error.message });
        if (error instanceof DiagnosticIndisponible)
          return reply.code(403).send({ error: error.message });
        if (error instanceof PassationImpossible)
          return reply.code(502).send({ error: error.message });
        throw error;
      }
    },
  );
}
