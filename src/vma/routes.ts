import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { ConnexionDeps } from '../connexions/service.js';
import type { Database } from '../db.js';
import { withInstance } from '../db/context.js';
import { getInstanceBySlug } from '../instances/service.js';
import {
  creerInvitation,
  creerLienProspectionVma,
  envoyerInvitation,
  InvitationImpossible,
  ouvrirEspaceTesteur,
  revoquerInvitation,
  SemestreAConfirmer,
  supprimerTest,
  TestIntrouvable,
  type InvitationDeps,
} from './invitations.js';
import {
  contactsVma,
  rattacherContactVma,
  retirerAccordVma,
  RattachementImpossible,
} from './contacts.js';
import { RelanceImpossible, relancerInvitation } from './relances.js';
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
  tutoiement: z.boolean().optional(),
  confirmerSemestre: z.boolean().optional(),
});

const relanceSchema = z.object({ tutoiement: z.boolean().optional() });

// Ce que l'écran affiche d'une invitation et de son résultat. Tout reste dans l'instance.
const vueTest = (t: TestVma) => ({
  id: t.id,
  entrepriseId: t.entrepriseId,
  opportuniteId: t.opportuniteId,
  entrepriseNom: t.entrepriseNom,
  contactNom: t.contactNom,
  contactEmail: t.contactEmail,
  contactId: t.contactId,
  contactPrenom: t.contactPrenom,
  contactNomFamille: t.contactNomFamille,
  contactPoste: t.contactPoste,
  contactTelephone: t.contactTelephone,
  origine: t.origine,
  consentement: t.consentement,
  tutoiement: t.tutoiement,
  envoyeeLe: t.envoyeeLe,
  relances: t.relances,
  echecEnvoi: t.echecEnvoi,
  mailOuvertLe: t.mailOuvertLe,
  lienOuvertLe: t.lienOuvertLe,
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
  // Réponses saisies par le dirigeant (chiffres, notes, profil) : pour préparer l'échange, jamais renvoyées au site.
  reponses: t.reponses,
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
    if (error instanceof RelanceImpossible) return reply.code(409).send({ error: error.message });
    if (error instanceof InvitationImpossible)
      return reply.code(400).send({ error: error.message });
    return reply.code(503).send({ error: 'Le site ne répond pas : réessayez dans un instant.' });
  };

  app.post<{ Params: { slug: string } }>(
    '/api/i/:slug/vma/liens-prospection',
    async (request, reply) => {
      if (!(await getInstanceBySlug(db, request.params.slug)))
        return reply.code(404).send({ error: 'Instance inconnue' });
      const avecSite = invitations();
      if (!avecSite) return reply.code(503).send({ error: 'Test VMA non configuré' });
      try {
        return await creerLienProspectionVma(avecSite);
      } catch (e) {
        return erreur(e, reply);
      }
    },
  );

  app.get<{ Params: { slug: string } }>('/api/i/:slug/vma/contacts', async (request, reply) => {
    const instance = await getInstanceBySlug(db, request.params.slug);
    if (!instance) return reply.code(404).send({ error: 'Instance inconnue' });
    return (await contactsVma(db, instance.id)).map((t) => ({
      ...vueTest(t),
      contactLie: t.contactLie,
      entrepriseLiee: t.entrepriseLiee,
    }));
  });

  app.patch<{ Params: { slug: string; id: string }; Body: unknown }>(
    '/api/i/:slug/vma/tests/:id/crm',
    async (request, reply) => {
      const instance = await getInstanceBySlug(db, request.params.slug);
      if (!instance) return reply.code(404).send({ error: 'Instance inconnue' });
      const parsed = z
        .object({
          contactId: z.uuid().nullable().optional(),
          opportuniteId: z.uuid().nullable().optional(),
          entrepriseId: z.uuid().nullable().optional(),
        })
        .strict()
        .safeParse(request.body);
      if (!UUID.test(request.params.id) || !parsed.success)
        return reply.code(400).send({ error: 'Rattachement invalide' });
      try {
        await rattacherContactVma(db, instance.id, request.params.id, parsed.data);
        return { ok: true };
      } catch (e) {
        if (e instanceof RattachementImpossible) return reply.code(404).send({ error: e.message });
        throw e;
      }
    },
  );

  app.post<{ Params: { slug: string; id: string } }>(
    '/api/i/:slug/vma/tests/:id/retirer-accord',
    async (request, reply) => {
      const instance = await getInstanceBySlug(db, request.params.slug);
      if (!instance) return reply.code(404).send({ error: 'Instance inconnue' });
      if (!UUID.test(request.params.id))
        return reply.code(400).send({ error: 'Invitation invalide' });
      try {
        await retirerAccordVma(db, instance.id, request.params.id);
        return { ok: true };
      } catch (e) {
        if (e instanceof RattachementImpossible) return reply.code(404).send({ error: e.message });
        throw e;
      }
    },
  );

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
          tutoiement: parsed.data.tutoiement ?? false,
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

  app.post<{ Params: { slug: string; id: string }; Body: unknown }>(
    '/api/i/:slug/vma/tests/:id/relancer',
    async (request, reply) => {
      const instance = await getInstanceBySlug(db, request.params.slug);
      if (!instance) return reply.code(404).send({ error: 'Instance inconnue' });
      if (!UUID.test(request.params.id)) {
        return reply.code(400).send({ error: 'Invitation invalide' });
      }
      const parsed = relanceSchema.safeParse(request.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: 'Relance invalide' });
      try {
        const envoi = await relancerInvitation(db, instance, deps.connexionDeps, {
          testId: request.params.id,
          origine: 'manuelle',
          ...(parsed.data.tutoiement === undefined ? {} : { tutoiement: parsed.data.tutoiement }),
        });
        const [test] = await withInstance(db, instance.id, (tx) =>
          tx
            .select()
            .from(vmaTests)
            .where(and(eq(vmaTests.instanceId, instance.id), eq(vmaTests.id, request.params.id))),
        );
        return { ...vueTest(test!), envoi };
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
