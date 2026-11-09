import type { FastifyInstance } from 'fastify';

// The OS has no accounts yet: listening on 127.0.0.1 keeps the network out, but not a web page
// open in the browser. A page served from evil.example can resolve its own name to 127.0.0.1
// (DNS rebinding) or post to localhost (CSRF). Both show up in the headers: a foreign Host for
// the first, a foreign Origin for the second.
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
// Navigations and reads stay open: Google's OAuth redirect comes back as a cross-site GET.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

const isLocal = (hostname: string | null) => hostname !== null && LOCAL_HOSTNAMES.has(hostname);

export function registerOriginGuard(app: FastifyInstance): void {
  app.addHook('onRequest', async (request, reply) => {
    const host = request.headers.host;
    if (!host || !isLocal(hostnameOf(`http://${host}`))) {
      return reply
        .code(403)
        .send({ error: "Ouvrez l'OS par http://localhost ou http://127.0.0.1." });
    }
    if (SAFE_METHODS.has(request.method)) return;
    // Non-browser clients (runner, MCP, curl) send neither header.
    const origin = request.headers.origin;
    if (
      (origin !== undefined && !isLocal(hostnameOf(origin))) ||
      request.headers['sec-fetch-site'] === 'cross-site'
    ) {
      return reply.code(403).send({ error: "Requête venue d'un autre site : refusée." });
    }
  });
}
