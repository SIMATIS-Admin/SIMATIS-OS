import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { withInstance } from '../db/context.js';
import { logEvent } from '../journal/service.js';
import { resolveToken, type ResolvedToken } from './tokens.js';
import { toolsFor, type McpDeps } from './tools.js';
import { readVersion } from '../version.js';

const asText = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
});
const asError = (error: unknown) => ({
  isError: true,
  content: [
    { type: 'text' as const, text: error instanceof Error ? error.message : String(error) },
  ],
});

// One server per request (stateless): its tools are bound to the instance of the token.
function buildServer({ jeton, instance }: ResolvedToken, deps: McpDeps): McpServer {
  const server = new McpServer({ name: 'simatis-os', version: readVersion() });
  const acteur = `agent:${jeton.nom}`;

  if (instance) {
    for (const tool of toolsFor('instance')) {
      if (tool.scope !== 'instance') continue;
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.input },
        async (input: unknown) => {
          try {
            const result = await withInstance(deps.db, instance.id, async (tx) => {
              await logEvent(tx, { acteur, action: `Outil MCP : ${tool.name}` });
              return tool.handler({ instance, tx, acteur, deps }, input as never);
            });
            return asText(result);
          } catch (error) {
            return asError(error);
          }
        },
      );
    }
  } else if (jeton.portee === 'portefeuille') {
    for (const tool of toolsFor('portefeuille')) {
      if (tool.scope !== 'portefeuille') continue;
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.input },
        async (input: unknown) => {
          try {
            return asText(await tool.handler({ acteur, deps }, input as never));
          } catch (error) {
            return asError(error);
          }
        },
      );
    }
  }
  return server;
}

export function registerMcp(app: FastifyInstance, deps: McpDeps): void {
  app.post('/mcp', async (request, reply) => {
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
    const resolved = token ? await resolveToken(deps.db, token) : null;
    if (!resolved) return reply.code(401).send({ error: 'Jeton MCP invalide ou révoqué' });

    const server = buildServer(resolved, deps);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    reply.hijack();
    reply.raw.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(request.raw, reply.raw, request.body);
  });

  const notAllowed = async (_request: unknown, reply: FastifyReply) =>
    reply.code(405).send({ error: 'Serveur MCP sans session : utiliser POST /mcp' });
  app.get('/mcp', notAllowed);
  app.delete('/mcp', notAllowed);
}
