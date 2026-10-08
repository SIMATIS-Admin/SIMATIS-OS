import { and, count, desc, eq } from 'drizzle-orm';
import type pg from 'pg';
import { z } from 'zod';
import { entreprises } from '../crm/schema.js';
import type { Database, Tx } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { listInstances } from '../instances/service.js';
import { recentEvents } from '../journal/service.js';
import { propositions } from '../propositions/schema.js';
import { MAX_LIGNES, runReadQuery, VUES } from './requete.js';

export type McpDeps = { db: Database; pool: pg.Pool; lectureRole: string; realWrites: boolean };

export type ToolCtx = { instance: Instance; tx: Tx; acteur: string; deps: McpDeps };
export type PortefeuilleCtx = { acteur: string; deps: McpDeps };

type InstanceTool = {
  name: string;
  description: string;
  input: z.ZodObject;
  scope: 'instance';
  handler: (ctx: ToolCtx, input: never) => Promise<unknown>;
};
type PortefeuilleTool = {
  name: string;
  description: string;
  input: z.ZodObject;
  scope: 'portefeuille';
  handler: (ctx: PortefeuilleCtx, input: never) => Promise<unknown>;
};
export type Tool = InstanceTool | PortefeuilleTool;

const tools = new Map<string, Tool>();

// Each business module adds its own tools; an instance tool runs inside withInstance.
export function registerTool<S extends z.ZodObject>(tool: {
  name: string;
  description: string;
  input: S;
  scope: 'instance';
  handler: (ctx: ToolCtx, input: z.infer<S>) => Promise<unknown>;
}): void;
export function registerTool<S extends z.ZodObject>(tool: {
  name: string;
  description: string;
  input: S;
  scope: 'portefeuille';
  handler: (ctx: PortefeuilleCtx, input: z.infer<S>) => Promise<unknown>;
}): void;
export function registerTool(tool: Tool): void {
  tools.set(tool.name, tool);
}

export const toolsFor = (scope: Tool['scope']) =>
  [...tools.values()].filter((t) => t.scope === scope);

registerTool({
  name: 'instance_courante',
  description: "L'instance (activité ou mandat) sur laquelle ce jeton travaille.",
  input: z.object({}),
  scope: 'instance',
  handler: ({ instance }) =>
    Promise.resolve({
      slug: instance.slug,
      nom: instance.nom,
      type: instance.type,
    }),
});

registerTool({
  name: 'journal_recent',
  description: "Les derniers événements du journal d'audit de l'instance (qui a fait quoi, quand).",
  input: z.object({ limite: z.number().int().min(1).max(100).default(20) }),
  scope: 'instance',
  handler: async ({ tx }, { limite }) => recentEvents(tx, limite),
});

registerTool({
  name: 'propositions_en_attente',
  description:
    'Les propositions (brouillons, tâches, modifications) qui attendent la décision du pilote.',
  input: z.object({}),
  scope: 'instance',
  handler: async ({ tx }) =>
    tx
      .select({
        id: propositions.id,
        type: propositions.type,
        auteur: propositions.auteur,
        niveau: propositions.niveau,
        contenu: propositions.contenu,
        creeeLe: propositions.createdAt,
      })
      .from(propositions)
      .where(and(eq(propositions.instanceId, currentInstance), eq(propositions.statut, 'proposee')))
      .orderBy(desc(propositions.createdAt))
      .limit(50),
});

registerTool({
  name: 'requete_lecture',
  description: `Requête SQL en lecture seule (une seule instruction SELECT, ${MAX_LIGNES} lignes au plus) sur les vues de l'instance : ${Object.entries(
    VUES,
  )
    .map(([vue, colonnes]) => `${vue} (${colonnes})`)
    .join(' ; ')}.`,
  input: z.object({ sql: z.string().min(1).max(4000) }),
  scope: 'instance',
  handler: async ({ instance, deps }, { sql }) =>
    runReadQuery(deps.pool, { instanceId: instance.id, lectureRole: deps.lectureRole, sql }),
});

registerTool({
  name: 'portefeuille',
  description:
    'Vue transversale de toutes les instances actives : uniquement des compteurs, jamais de données.',
  input: z.object({}),
  scope: 'portefeuille',
  handler: async ({ deps }) => {
    const list = await listInstances(deps.db);
    return Promise.all(
      list.map((i) =>
        withInstance(deps.db, i.id, async (tx) => {
          const [aValider] = await tx
            .select({ n: count() })
            .from(propositions)
            .where(
              and(
                eq(propositions.instanceId, currentInstance),
                eq(propositions.statut, 'proposee'),
              ),
            );
          const [nbEntreprises] = await tx
            .select({ n: count() })
            .from(entreprises)
            .where(eq(entreprises.instanceId, currentInstance));
          return {
            slug: i.slug,
            nom: i.nom,
            type: i.type,
            aValider: aValider?.n ?? 0,
            entreprises: nbEntreprises?.n ?? 0,
          };
        }),
      ),
    );
  },
});
