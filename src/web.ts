import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

// Same relative path from src/ (dev, tests) and dist/ (build); absent until `npm run build`.
const webRoot = fileURLToPath(new URL('../dist/web', import.meta.url));

export function registerWeb(app: FastifyInstance): void {
  if (existsSync(webRoot)) void app.register(fastifyStatic, { root: webRoot });
}
