import { and, desc, eq, gte, isNotNull, isNull, lte, ne } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { rendezVous } from '../crm/schema.js';
import { currentInstance } from '../db/columns.js';
import type { Database } from '../db.js';
import { withInstance } from '../db/context.js';
import { getInstanceBySlug, listInstances } from '../instances/service.js';
import { logEvent } from '../journal/service.js';
import {
  clore,
  cloturerAbandonnees,
  finaliser,
  finaliserCloses,
  lireSession,
  ouvrirSession,
  poserTexte,
  recevoirMorceau,
  SessionCloseErreur,
} from './enregistrement.js';
import { enregistrementsVisio, morceauxVisio, PISTES } from './schema.js';

// Un morceau d'environ 30 s en webm/opus pèse une centaine de Ko : au-delà, c'est une erreur.
export const MORCEAU_MAX = 5_000_000;
const AVANT_MS = 4 * 3_600_000;
const APRES_MS = 2 * 3_600_000;
const PAR_PASSAGE = 10;

const pisteSchema = z.enum(PISTES);
const rangSchema = z.coerce.number().int().min(0).max(10_000);
const texteSchema = z.object({ texte: z.string().max(20_000), debutMs: z.number().int().min(0) });

type SlugParams = { slug: string };
type SessionParams = SlugParams & { id: string };

// Interface de la capture (bouton du navigateur, plus tard appli à part) : elle ne connaît que ces
// routes, jamais les tables.
export function registerEnregistrementRoutes(app: FastifyInstance, { db }: { db: Database }): void {
  // Le son arrive tel quel dans le corps de la requête.
  app.addContentTypeParser(
    /^audio\//,
    { parseAs: 'buffer', bodyLimit: MORCEAU_MAX },
    (_r, body, done) => done(null, body),
  );

  async function instanceDe(slug: string, reply: FastifyReply) {
    const instance = await getInstanceBySlug(db, slug);
    if (!instance) void reply.code(404).send({ error: 'Instance inconnue' });
    return instance;
  }

  app.get<{ Params: SlugParams }>('/api/i/:slug/visio/rendez-vous', async (request, reply) => {
    const instance = await instanceDe(request.params.slug, reply);
    if (!instance) return reply;
    const maintenant = Date.now();
    return withInstance(db, instance.id, async (tx) =>
      (
        await tx
          .select()
          .from(rendezVous)
          .where(
            and(
              eq(rendezVous.instanceId, currentInstance),
              ne(rendezVous.statut, 'ignore'),
              gte(rendezVous.debut, new Date(maintenant - AVANT_MS)),
              lte(rendezVous.debut, new Date(maintenant + APRES_MS)),
            ),
          )
          .orderBy(rendezVous.debut)
      ).map((r) => ({
        id: r.eventId,
        titre: r.titre,
        debut: r.debut,
        fin: r.fin,
        lienVisio: r.lienVisio,
      })),
    );
  });

  app.post<{ Params: SlugParams; Body: unknown }>(
    '/api/i/:slug/visio/sessions',
    async (request, reply) => {
      const instance = await instanceDe(request.params.slug, reply);
      if (!instance) return reply;
      const parsed = z.object({ rdvId: z.string().min(1).max(300) }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Rendez-vous manquant' });
      const session = await withInstance(db, instance.id, async (tx) => {
        const [r] = await tx
          .select({ id: rendezVous.id })
          .from(rendezVous)
          .where(
            and(
              eq(rendezVous.instanceId, currentInstance),
              eq(rendezVous.eventId, parsed.data.rdvId),
            ),
          );
        return r ? ouvrirSession(tx, r.id) : null;
      });
      if (!session) return reply.code(404).send({ error: 'Rendez-vous introuvable' });
      return reply.code(201).send(session);
    },
  );

  app.put<{ Params: SessionParams & { piste: string; rang: string }; Body: unknown }>(
    '/api/i/:slug/visio/sessions/:id/morceaux/:piste/:rang',
    { bodyLimit: MORCEAU_MAX },
    async (request, reply) => {
      const instance = await instanceDe(request.params.slug, reply);
      if (!instance) return reply;
      const piste = pisteSchema.safeParse(request.params.piste);
      const rang = rangSchema.safeParse(request.params.rang);
      if (!piste.success || !rang.success)
        return reply.code(400).send({ error: 'Morceau invalide' });
      const brut = Buffer.isBuffer(request.body) ? request.body : null;
      const json = brut ? null : texteSchema.safeParse(request.body);
      if (json && !json.success) return reply.code(400).send({ error: 'Morceau invalide' });
      const debutMs = brut
        ? Number(request.headers['x-debut-ms'] ?? 0)
        : (json?.data?.debutMs ?? 0);
      if (!Number.isInteger(debutMs) || debutMs < 0) {
        return reply.code(400).send({ error: 'Début du morceau invalide' });
      }
      try {
        const existe = await withInstance(db, instance.id, async (tx) => {
          if (!(await lireSession(tx, request.params.id))) return false;
          await recevoirMorceau(tx, request.params.id, {
            piste: piste.data,
            rang: rang.data,
            debutMs,
            ...(brut
              ? { audio: brut, mime: String(request.headers['content-type'] ?? 'audio/webm') }
              : { texte: json?.data?.texte ?? '' }),
          });
          return true;
        });
        if (!existe) return reply.code(404).send({ error: 'Session introuvable' });
      } catch (e) {
        if (e instanceof SessionCloseErreur) return reply.code(409).send({ error: e.message });
        throw e;
      }
      return reply.code(204).send();
    },
  );

  app.post<{ Params: SessionParams }>(
    '/api/i/:slug/visio/sessions/:id/fin',
    async (request, reply) => {
      const instance = await instanceDe(request.params.slug, reply);
      if (!instance) return reply;
      const session = await withInstance(db, instance.id, async (tx) => {
        if (!(await lireSession(tx, request.params.id))) return null;
        await clore(tx, request.params.id);
        await finaliser(tx, request.params.id);
        return lireSession(tx, request.params.id);
      });
      if (!session) return reply.code(404).send({ error: 'Session introuvable' });
      return { statut: session.statut };
    },
  );

  app.get<{ Params: SessionParams }>('/api/i/:slug/visio/sessions/:id', async (request, reply) => {
    const instance = await instanceDe(request.params.slug, reply);
    if (!instance) return reply;
    const session = await withInstance(db, instance.id, (tx) => lireSession(tx, request.params.id));
    if (!session) return reply.code(404).send({ error: 'Session introuvable' });
    return resume(session);
  });

  // Dernière session d'un rendez-vous : la fiche y retrouve le transcript après un rechargement.
  app.get<{ Params: SlugParams & { rdvId: string } }>(
    '/api/i/:slug/visio/rendez-vous/:rdvId/session',
    async (request, reply) => {
      const instance = await instanceDe(request.params.slug, reply);
      if (!instance) return reply;
      const session = await withInstance(db, instance.id, async (tx) => {
        const [r] = await tx
          .select({ id: enregistrementsVisio.id })
          .from(enregistrementsVisio)
          .innerJoin(rendezVous, eq(rendezVous.id, enregistrementsVisio.rendezVousId))
          .where(
            and(
              eq(enregistrementsVisio.instanceId, currentInstance),
              eq(rendezVous.eventId, request.params.rdvId),
            ),
          )
          .orderBy(desc(enregistrementsVisio.debutAt))
          .limit(1);
        return r ? lireSession(tx, r.id) : null;
      });
      return session ? resume(session) : reply.code(404).send({ error: 'Aucune session' });
    },
  );
}

const resume = (s: NonNullable<Awaited<ReturnType<typeof lireSession>>>) => ({
  id: s.id,
  statut: s.statut,
  debutAt: s.debutAt,
  transcript: s.transcript,
  morceaux: s.morceaux.length,
  transcrits: s.morceaux.filter((m) => m.texte !== null).length,
});

// Interface de l'exécuteur du poste : il lit les morceaux à transcrire et rend leur texte.
export function registerTranscriptionRunnerRoutes(
  app: FastifyInstance,
  {
    db,
    auth,
  }: { db: Database; auth: (request: FastifyRequest, reply: FastifyReply) => Promise<boolean> },
): void {
  app.get('/api/runner/transcriptions', async (request, reply) => {
    if (!(await auth(request, reply))) return reply;
    const out = [];
    for (const instance of await listInstances(db)) {
      const rows = await withInstance(db, instance.id, async (tx) => {
        await cloturerAbandonnees(tx, new Date());
        await finaliserCloses(tx);
        return tx
          .select({
            enregistrementId: morceauxVisio.enregistrementId,
            piste: morceauxVisio.piste,
            rang: morceauxVisio.rang,
            mime: morceauxVisio.mime,
            audio: morceauxVisio.audio,
          })
          .from(morceauxVisio)
          .where(
            and(
              eq(morceauxVisio.instanceId, currentInstance),
              isNotNull(morceauxVisio.audio),
              isNull(morceauxVisio.texte),
            ),
          )
          .orderBy(morceauxVisio.createdAt)
          .limit(PAR_PASSAGE);
      });
      for (const m of rows) {
        out.push({
          instance: instance.slug,
          enregistrementId: m.enregistrementId,
          piste: m.piste,
          rang: m.rang,
          mime: m.mime,
          audio: (m.audio ?? Buffer.alloc(0)).toString('base64'),
        });
      }
    }
    return out;
  });

  const rendu = z.object({
    instance: z.string().min(1),
    texte: z.string().max(100_000),
    erreur: z.string().max(500).optional(),
  });
  app.post<{ Params: { id: string; piste: string; rang: string }; Body: unknown }>(
    '/api/runner/transcriptions/:id/:piste/:rang',
    async (request, reply) => {
      if (!(await auth(request, reply))) return reply;
      const corps = rendu.safeParse(request.body);
      const piste = pisteSchema.safeParse(request.params.piste);
      const rang = rangSchema.safeParse(request.params.rang);
      if (!corps.success || !piste.success || !rang.success) {
        return reply.code(400).send({ error: 'Texte invalide' });
      }
      const instance = await getInstanceBySlug(db, corps.data.instance);
      if (!instance) return reply.code(404).send({ error: 'Instance inconnue' });
      const statut = await withInstance(db, instance.id, async (tx) => {
        if (corps.data.erreur) {
          await logEvent(tx, {
            acteur: 'os',
            action: `Transcription d'un morceau de visio impossible : ${corps.data.erreur}`,
          });
        }
        await poserTexte(tx, request.params.id, piste.data, rang.data, corps.data.texte);
        await finaliser(tx, request.params.id);
        return (await lireSession(tx, request.params.id))?.statut ?? null;
      });
      return { statut };
    },
  );
}
