import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ErreurRelais } from 'os-agents-relay';
import { z } from 'zod';
import type { Database } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { getInstanceBySlug } from '../instances/service.js';
import { logEvent } from '../journal/service.js';
import { NIVEAUX } from '../propositions/autonomie.js';
import { canWriteReal } from '../propositions/service.js';
import { loadInstanceSecrets } from '../secrets.js';
import {
  CHAMPS_EXCLUABLES,
  OBJETS_CRM,
  partenaires,
  type ChampExcluable,
  type Partenaire,
} from './schema.js';
import {
  couper,
  estPorteuse,
  listerPartenaires,
  missionsRecentes,
  PartenaireRefuse,
  rejoindre,
  SECRET_NOEUD,
} from './service.js';

export type PartenairesRoutesDeps = {
  db: Database;
  secretsDir: string;
  realWrites: boolean;
  // Agents relay; null = module off (RELAIS_URL unset).
  relais: { url: string; fetch?: typeof fetch } | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Never the node secret: only what the screen shows.
const vue = (p: Partenaire) => ({
  id: p.id,
  nom: p.nom,
  connecteDepuis: p.createdAt,
  niveau: p.niveau,
  voit: p.voit,
  statut: p.statut,
  coupeeAt: p.coupeeAt,
  synchroAt: p.synchroAt,
});

const rejoindreSchema = z.object({ lien: z.string().trim().min(1).max(500) });
const CLES_EXCLUABLES = CHAMPS_EXCLUABLES.map((c) => c.cle) as [
  ChampExcluable,
  ...ChampExcluable[],
];
const patchSchema = z
  .object({
    niveau: z.enum(NIVEAUX).optional(),
    voit: z
      .object({
        objets: z.array(z.enum(OBJETS_CRM)).max(OBJETS_CRM.length),
        champsExclus: z.array(z.enum(CLES_EXCLUABLES)).max(CLES_EXCLUABLES.length),
        qualification: z.boolean(),
      })
      .optional(),
  })
  .refine((v) => v.niveau !== undefined || v.voit !== undefined, 'Rien à modifier');

export function registerPartenairesRoutes(
  app: FastifyInstance,
  { db, secretsDir, realWrites, relais }: PartenairesRoutesDeps,
): void {
  type Rt = { Params: { slug: string; id: string }; Body: unknown };
  const surInstance =
    (action: (i: Instance, request: FastifyRequest<Rt>, reply: FastifyReply) => unknown) =>
    async (request: FastifyRequest<Rt>, reply: FastifyReply) => {
      const instance = await getInstanceBySlug(db, request.params.slug);
      if (!instance) return reply.code(404).send({ error: 'Instance inconnue' });
      try {
        return await action(instance, request, reply);
      } catch (e) {
        if (e instanceof PartenaireRefuse) return reply.code(400).send({ error: e.message });
        if (e instanceof ErreurRelais) {
          return reply.code(502).send({ error: `Relais : ${e.message}` });
        }
        throw e;
      }
    };
  const relaisDeps = () => {
    if (!relais) throw new PartenaireRefuse('Relais non configuré (RELAIS_URL).');
    return { ...relais, secretsDir, realWrites };
  };

  app.get<Rt>(
    '/api/i/:slug/partenaires',
    surInstance(async (i) => {
      const secrets = await loadInstanceSecrets(secretsDir, i.slug);
      return withInstance(db, i.id, async (tx) => ({
        actif: relais !== null,
        porteuse: estPorteuse(i),
        ecrituresReelles: canWriteReal(i, realWrites),
        inscrit: Boolean(secrets[SECRET_NOEUD]),
        objets: OBJETS_CRM,
        champsExcluables: CHAMPS_EXCLUABLES,
        partenaires: (await listerPartenaires(tx)).map(vue),
        missions: await missionsRecentes(tx, { limite: 10 }),
      }));
    }),
  );

  app.post<Rt>(
    '/api/i/:slug/partenaires/rejoindre',
    surInstance(async (i, request, reply) => {
      const parsed = rejoindreSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Lien d'invitation manquant" });
      const p = await rejoindre(db, i, parsed.data.lien, relaisDeps(), 'pilote');
      return { partenaire: vue(p) };
    }),
  );

  app.patch<Rt>(
    '/api/i/:slug/partenaires/:id',
    surInstance(async (i, request, reply) => {
      const parsed = patchSchema.safeParse(request.body);
      if (!parsed.success || !UUID.test(request.params.id)) {
        return reply.code(400).send({ error: 'Réglage invalide' });
      }
      const { niveau, voit } = parsed.data;
      const row = await withInstance(db, i.id, async (tx) => {
        const [r] = await tx
          .update(partenaires)
          .set({
            ...(niveau ? { niveau } : {}),
            ...(voit
              ? {
                  voit: {
                    objets: [...new Set(voit.objets)],
                    champsExclus: [...new Set(voit.champsExclus)],
                    qualification: voit.qualification,
                  },
                  // What the partner sees changed: the next pass compares every record.
                  passeCompleteAt: null,
                }
              : {}),
            updatedAt: new Date(),
          })
          .where(
            and(eq(partenaires.instanceId, currentInstance), eq(partenaires.id, request.params.id)),
          )
          .returning();
        if (r) {
          await logEvent(tx, {
            acteur: 'pilote',
            action: `Réglages du partenaire ${r.nom} : ${[
              niveau && `missions reçues ${niveau}`,
              voit &&
                `voit ${voit.objets.join(', ') || 'rien'}${
                  voit.champsExclus.length ? `, sans ${voit.champsExclus.join(', ')}` : ''
                }${voit.qualification ? ', qualification comprise' : ''}`,
            ]
              .filter(Boolean)
              .join(' ; ')}`,
          });
        }
        return r;
      });
      if (!row) return reply.code(404).send({ error: 'Partenaire introuvable' });
      return { partenaire: vue(row) };
    }),
  );

  app.delete<Rt>(
    '/api/i/:slug/partenaires/:id',
    surInstance(async (i, request, reply) => {
      if (!UUID.test(request.params.id)) {
        return reply.code(404).send({ error: 'Partenaire introuvable' });
      }
      const p = await couper(db, i, request.params.id, relaisDeps(), 'pilote');
      if (!p) return reply.code(404).send({ error: 'Partenaire introuvable' });
      return { partenaire: vue(p) };
    }),
  );
}
