import type { FastifyInstance } from 'fastify';
import { lireLimitesIA } from './limites.js';

export function registerLimitesIARoutes(app: FastifyInstance, fichier: string): void {
  app.get('/api/limites-ia', () => lireLimitesIA(fichier));
}
