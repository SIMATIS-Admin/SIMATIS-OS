import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

// Same relative path from src/ (dev, tests) and dist/ (build); absent until `npm run build`.
const webRoot = fileURLToPath(new URL('../dist/web', import.meta.url));

// Assets carry a content hash in their name and can be cached; index.html must always be
// revalidated, otherwise the browser keeps showing the previous version after an update.
export const cacheControlFor = (filePath: string) =>
  filePath.endsWith('.html') ? 'no-cache' : 'public, max-age=31536000, immutable';

export function registerWeb(app: FastifyInstance): void {
  if (!existsSync(webRoot)) return;
  void app.register(fastifyStatic, {
    root: webRoot,
    cacheControl: false,
    setHeaders: (reply, filePath) => {
      void reply.header('cache-control', cacheControlFor(filePath));
    },
  });
}
