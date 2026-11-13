import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db.js';
import { deposerMessagesPartage } from '../inbox/messages-partage.js';
import { getInstanceBySlug } from '../instances/service.js';
import { resolveToken } from '../mcp/tokens.js';
import { estEchange, messagesRelayes, miroirVersRelais } from '../partenaires/echanges.js';
import { demander, prendre, repondre, RunnerInjoignable } from './file.js';
import { deposerCarte, lireCarte } from './store.js';

const espaceSchema = z.enum(['simatis', 'partage']).optional();

const carteSchema = z.object({
  espace: espaceSchema,
  noeuds: z
    .array(
      z.object({
        id: z.string().max(500),
        titre: z.string().max(500),
        categorie: z.string().max(100),
        statut: z.string().max(50).nullable(),
        concerne: z.string().max(50).nullable().optional(),
        genre: z.string().max(50).nullable().optional(),
        auteur: z.string().max(50).nullable().optional(),
        date: z.string().max(50).nullable().optional(),
        reponseA: z.string().max(500).nullable().optional(),
      }),
    )
    .max(10_000),
  liens: z.array(z.object({ de: z.string().max(500), vers: z.string().max(500) })).max(100_000),
  autresFichiers: z.number().int().min(0),
  fichiers: z.array(z.string().max(500)).max(1000).optional(),
  moi: z.string().max(50).optional(),
  tronquee: z.boolean(),
});

const operationSchema = z.discriminatedUnion('type', [
  z.object({ espace: espaceSchema, type: z.literal('lire'), chemin: z.string().max(300) }),
  z.object({
    espace: espaceSchema,
    type: z.literal('ecrire'),
    chemin: z.string().max(300),
    contenu: z.string().max(500_000),
    empreinte: z.string().max(100),
  }),
  z.object({
    espace: espaceSchema,
    type: z.literal('ajouter'),
    titre: z.string().trim().min(1).max(200),
    texte: z.string().max(500_000),
    concerne: z.literal('os').optional(),
  }),
  z.object({
    espace: z.literal('partage'),
    type: z.literal('message'),
    genre: z.enum(['question', 'reponse', 'info']),
    sujet: z.string().trim().min(1).max(200),
    corps: z.string().trim().min(1).max(100_000),
    enReponseA: z.string().max(300).optional(),
  }),
  z.object({ espace: z.literal('partage'), type: z.literal('actualiser') }),
  z.object({
    espace: z.literal('partage'),
    type: z.literal('chercher'),
    requete: z.string().trim().min(1).max(200),
  }),
  z.object({
    espace: z.literal('partage'),
    type: z.literal('lire_messages'),
    chemins: z.array(z.string().max(300)).min(1).max(50),
  }),
]);

const resultatSchema = z.union([
  z.object({
    ok: z.literal(true),
    chemin: z.string().optional(),
    contenu: z.string().optional(),
    empreinte: z.string().optional(),
    lectureSeule: z.string().nullable().optional(),
    resultats: z
      .array(z.object({ chemin: z.string().max(500), extraits: z.array(z.string().max(1000)) }))
      .max(200)
      .optional(),
    textes: z.record(z.string(), z.string().max(500_000)).optional(),
  }),
  z.object({ ok: z.literal(false), erreur: z.string().max(1000), conflit: z.boolean().optional() }),
]);

export function registerCerveauRoutes(
  app: FastifyInstance,
  {
    db,
    lienKdrive = null,
    realWrites = false,
  }: { db: Database; lienKdrive?: string | null; realWrites?: boolean },
): void {
  const estRunner = async (request: FastifyRequest) => {
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const resolved = token ? await resolveToken(db, token) : null;
    return resolved?.jeton.portee === 'runner';
  };
  const refus = (reply: FastifyReply) =>
    reply.code(401).send({ error: "Jeton d'exécuteur invalide" });

  // Le runner du poste lit le dossier du second cerveau et en dépose la carte.
  app.post<{ Body: unknown }>('/api/runner/cerveau/carte', async (request, reply) => {
    if (!(await estRunner(request))) return refus(reply);
    const parsed = carteSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Carte invalide' });
    const { espace, ...carte } = parsed.data;
    deposerCarte(carte, espace);
    // Un nouveau message de l'autre entre dans l'Inbox sans attendre la routine du matin.
    if (espace === 'partage') {
      const instance = await getInstanceBySlug(db, 'simatis');
      if (instance)
        await deposerMessagesPartage(db, instance, carte).catch((err: unknown) =>
          request.log.error(err, 'Inbox : messages de l’espace partagé'),
        );
    }
    return { ok: true };
  });

  // Jamais une démo, qui ne doit rien voir du vrai. Le cerveau SIMATIS est réservé à Mon activité ;
  // l'espace d'un partenaire s'ouvre aussi à un mandat qui a le module (il ne voit que cet espace).
  const acces = async (slug: string, reply: FastifyReply, partage: boolean) => {
    const instance = await getInstanceBySlug(db, slug);
    if (!instance) return reply.code(404).send({ error: 'Instance inconnue' });
    const typeAutorise = instance.type === 'propre' || (partage && instance.type === 'mandat');
    if (!typeAutorise || !(instance.config.modules ?? []).includes('cerveau'))
      return reply.code(403).send({ error: "Le second cerveau n'est pas activé dans cet espace." });
    return null;
  };

  app.get<{ Params: { slug: string }; Querystring: { espace?: string } }>(
    '/api/i/:slug/cerveau/carte',
    async (request, reply) => {
      const partage = request.query.espace === 'partage';
      const refuse = await acces(request.params.slug, reply, partage);
      if (refuse) return refuse;
      const carte = lireCarte(partage ? 'partage' : 'simatis');
      if (!carte || !partage) return carte;
      // Les messages reçus par le relais sans fichier dans echanges/ s'ajoutent aux échanges.
      const instance = await getInstanceBySlug(db, request.params.slug);
      const relayes = instance ? await messagesRelayes(db, instance, carte.moi ?? 'marc') : [];
      const connus = new Set(carte.noeuds.map((n) => n.id));
      const noeuds = [...carte.noeuds, ...relayes.filter((n) => !connus.has(n.id))];
      // Lien du dossier partagé sur le kDrive : une configuration de l'OS, pas un contenu de la carte.
      return { ...carte, noeuds, lienKdrive };
    },
  );

  // Lire, enregistrer une note ou ajouter une idée : exécuté par le runner, sur le dossier du Drive.
  app.post<{ Params: { slug: string }; Body: unknown }>(
    '/api/i/:slug/cerveau/operations',
    async (request, reply) => {
      const parsed = operationSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Demande invalide' });
      const refuse = await acces(request.params.slug, reply, parsed.data.espace === 'partage');
      if (refuse) return refuse;
      try {
        const resultat = await demander(parsed.data);
        if (resultat.ok) {
          // Le fichier est déposé : le même message part par le relais. Un échec du relais ne défait
          // pas le dépôt (le message est dans echanges/), il est signalé à l'écran.
          const op = parsed.data;
          if (op.type !== 'message' || op.espace !== 'partage') return resultat;
          const instance = await getInstanceBySlug(db, request.params.slug);
          const chemin = resultat.chemin;
          if (!instance || !chemin || !estEchange(chemin)) return resultat;
          const relais = await miroirVersRelais(db, instance, realWrites, {
            genre: op.genre,
            sujet: op.sujet,
            corps: op.corps,
            enReponseA: op.enReponseA,
            chemin,
          }).catch((e: unknown) => ({
            statut: 'erreur' as const,
            raison: e instanceof Error ? e.message : String(e),
          }));
          return { ...resultat, relais };
        }
        return reply.code(resultat.conflit ? 409 : 400).send({ error: resultat.erreur });
      } catch (e) {
        if (e instanceof RunnerInjoignable)
          return reply.code(504).send({
            error:
              "L'exécuteur de l'ordinateur ne répond pas : vérifiez qu'il tourne (Automatismes) et que le Drive est synchronisé.",
          });
        throw e;
      }
    },
  );

  app.get('/api/runner/cerveau/operations', async (request, reply) => {
    if (!(await estRunner(request))) return refus(reply);
    return prendre();
  });

  app.post<{ Params: { id: string }; Body: unknown }>(
    '/api/runner/cerveau/operations/:id',
    async (request, reply) => {
      if (!(await estRunner(request))) return refus(reply);
      const parsed = resultatSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Résultat invalide' });
      return { ok: repondre(request.params.id, parsed.data) };
    },
  );
}
