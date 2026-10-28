import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { ConnexionDeps } from '../connexions/service.js';
import type { Database } from '../db.js';
import { withInstance } from '../db/context.js';
import { getInstanceBySlug } from '../instances/service.js';
import {
  creerInvitation,
  envoyerInvitation,
  InvitationImpossible,
  ouvrirEspaceTesteur,
  revoquerInvitation,
  SemestreAConfirmer,
  supprimerTest,
  TestIntrouvable,
  type InvitationDeps,
} from './invitations.js';
import { TYPES_TEST_VMA, vmaTests, type TestVma } from './schema.js';

export type VmaRoutesDeps = {
  db: Database;
  connexionDeps: ConnexionDeps;
  // Site et jeton des invitations ; null tant que le Test de VMA n'est pas configuré.
  vma: { url: string; token: string } | null;
  fetch?: typeof fetch;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const creationSchema = z.object({
  entrepriseId: z.uuid().nullish(),
  entrepriseNom: z.string().trim().min(1, "Nom de l'entreprise manquant").max(160),
  type: z.enum(TYPES_TEST_VMA),
  contactNom: z.string().trim().max(120).nullish(),
  contactEmail: z.string().trim().max(200).nullish(),
  confirmerSemestre: z.boolean().optional(),
});

// Ce que l'écran affiche d'une invitation et de son résultat. Tout reste dans l'instance.
const vueTest = (t: TestVma) => ({
  id: t.id,
  entrepriseId: t.entrepriseId,
  entrepriseNom: t.entrepriseNom,
  contactNom: t.contactNom,
  contactEmail: t.contactEmail,
  type: t.type,
  statut: t.statut,
  lien: t.lien,
  expireLe: t.expireLe,
  creeLe: t.createdAt,
  recueLe: t.recueLe,
  version: t.version,
  // Écran du dirigeant (ce qu'il a vu) et calcul complet pour la fiche de Marc.
  resultat: t.ecran,
  calcul: t.calcul,
  parametres: t.parametres,
});

export function registerVmaRoutes(app: FastifyInstance, deps: VmaRoutesDeps): void {
  const { db, vma } = deps;

  const invitations = (): InvitationDeps | null =>
    vma ? { url: vma.url, token: vma.token, ...(deps.fetch ? { fetch: deps.fetch } : {}) } : null;

  // Refus clair : une invitation refusée par le site ou par l'OS, ou un site injoignable.
  const erreur = (error: unknown, reply: FastifyReply) => {
    // Alerte du semestre : 409 avec le test précédent, pour que l'écran propose la confirmation.
    if (error instanceof SemestreAConfirmer)
      return reply
        .code(409)
        .send({ error: error.message, code: 'semestre', dernierTest: error.dernier });
    if (error instanceof TestIntrouvable)
      return reply.code(404).send({ error: 'Test introuvable' });
    if (error instanceof InvitationImpossible)
      return reply.code(400).send({ error: error.message });
    return reply.code(503).send({ error: 'Le site ne répond pas : réessayez dans un instant.' });
  };

  app.get<{ Params: { slug: string } }>('/api/i/:slug/vma/tests', async (request, reply) => {
    const instance = await getInstanceBySlug(db, request.params.slug);
    if (!instance) return reply.code(404).send({ error: 'Instance inconnue' });
    const lignes = await withInstance(db, instance.id, (tx) =>
      tx
        .select()
        .from(vmaTests)
        .where(eq(vmaTests.instanceId, instance.id))
        .orderBy(desc(vmaTests.createdAt)),
    );
    return lignes.map(vueTest);
  });

  app.post<{ Params: { slug: string }; Body: unknown }>(
    '/api/i/:slug/vma/tests',
    async (request, reply) => {
      const instance = await getInstanceBySlug(db, request.params.slug);
      if (!instance) return reply.code(404).send({ error: 'Instance inconnue' });
      const parsed = creationSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: parsed.error.issues[0]?.message ?? 'Invitation invalide' });
      }
      const avecSite = invitations();
      if (!avecSite) {
        return reply.code(503).send({ error: 'Test de VMA non configuré (VMA_OS_TOKEN)' });
      }
      try {
        const test = await creerInvitation(db, avecSite, {
          instanceId: instance.id,
          entrepriseId: parsed.data.entrepriseId ?? null,
          entrepriseNom: parsed.data.entrepriseNom,
          type: parsed.data.type,
          contactNom: parsed.data.contactNom ?? null,
          contactEmail: parsed.data.contactEmail ?? null,
          confirmerSemestre: parsed.data.confirmerSemestre ?? false,
        });
        // Le mail part tout de suite si une adresse est donnée ; son résultat accompagne l'invitation.
        const envoi = test.contactEmail
          ? await envoyerInvitation(db, instance, deps.connexionDeps, test)
          : null;
        return reply.code(201).send({ ...vueTest(test), envoi });
      } catch (error) {
        return erreur(error, reply);
      }
    },
  );

  app.post<{ Params: { slug: string } }>('/api/i/:slug/vma/testeur', async (request, reply) => {
    const instance = await getInstanceBySlug(db, request.params.slug);
    if (!instance) return reply.code(404).send({ error: 'Instance inconnue' });
    const avecSite = invitations();
    if (!avecSite) {
      return reply.code(503).send({ error: 'Test de VMA non configuré (VMA_OS_TOKEN)' });
    }
    try {
      return await ouvrirEspaceTesteur(avecSite);
    } catch (error) {
      return erreur(error, reply);
    }
  });

  app.post<{ Params: { slug: string; id: string } }>(
    '/api/i/:slug/vma/tests/:id/revoquer',
    async (request, reply) => {
      const instance = await getInstanceBySlug(db, request.params.slug);
      if (!instance) return reply.code(404).send({ error: 'Instance inconnue' });
      if (!UUID.test(request.params.id)) {
        return reply.code(400).send({ error: 'Invitation invalide' });
      }
      const avecSite = invitations();
      if (!avecSite) {
        return reply.code(503).send({ error: 'Test de VMA non configuré (VMA_OS_TOKEN)' });
      }
      try {
        const test = await revoquerInvitation(db, avecSite, {
          instanceId: instance.id,
          testId: request.params.id,
        });
        return vueTest(test);
      } catch (error) {
        return erreur(error, reply);
      }
    },
  );

  app.delete<{ Params: { slug: string; id: string } }>(
    '/api/i/:slug/vma/tests/:id',
    async (request, reply) => {
      const instance = await getInstanceBySlug(db, request.params.slug);
      if (!instance) return reply.code(404).send({ error: 'Instance inconnue' });
      if (!UUID.test(request.params.id)) return reply.code(400).send({ error: 'Test invalide' });
      try {
        await supprimerTest(db, invitations(), {
          instanceId: instance.id,
          testId: request.params.id,
        });
        return { ok: true };
      } catch (error) {
        return erreur(error, reply);
      }
    },
  );
}
