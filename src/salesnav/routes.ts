import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { ConnexionDeps } from '../connexions/service.js';
import { ajouterAuRadar } from '../crm/ajout-radar.js';
import type { Database } from '../db.js';
import { withInstance } from '../db/context.js';
import { getInstanceBySlug } from '../instances/service.js';
import {
  CampagneIntrouvable,
  creerCampagne,
  LIMITE_INVITATION,
  listerCampagnes,
  listerModeles,
  messageEffectif,
  ModeleInvalide,
  rendre,
  retirerSurcharge,
  sauverModele,
  sauverSurcharge,
  supprimerCampagne,
} from './modeles.js';
import {
  ajouterProspect,
  choisirCible,
  disponiblesDansLaBase,
  ecarter,
  enregistrerMessage,
  JOURS_AVANT_RETRAIT,
  lierOpportunite,
  listerProspects,
  marquerConnecte,
  marquerDemandeEnvoyee,
  marquerReponse,
  marquerSansReponse,
  proposerDuJour,
  ProspectIntrouvable,
  ProspectInvalide,
  statsPipe,
} from './prospects.js';
import { ActionInvalide, ActionRefusee, enregistrerAction, indicateurs } from './actions.js';
import { DejaEnCours, demanderExecution } from '../routines/service.js';
import { alerteAcceptation, demanderEnvoi, derniersEnvois, EnvoiRefuse } from './envois.js';
import { lireReglages, ReglageInvalide, sauverReglages } from './reglages.js';
import { ETAPES_SALESNAV } from './schema.js';

export type SalesnavRoutesDeps = { db: Database; connexionDeps: ConnexionDeps };

const texteSchema = z.object({ texte: z.string().max(10_000) });
const campagneSchema = z.object({ nom: z.string().max(200), icp: z.string().max(200) });
const reglagesSchema = z.object({
  quotaJour: z.number().optional(),
  pause: z.boolean().optional(),
  essaiABlanc: z.boolean().optional(),
});
const actionSchema = z.object({
  type: z.string().max(40),
  opportuniteId: z.uuid().nullable().optional(),
  campagneId: z.uuid().nullable().optional(),
});
const prospectSchema = z.object({
  lien: z.string().max(500),
  nom: z.string().max(200),
  fonction: z.string().max(200).nullable().optional(),
  entreprise: z.string().max(200).nullable().optional(),
  cible: z.string().max(200).nullable().optional(),
});
const cibleSchema = z.object({ cible: z.string().max(200).nullable() });
const ACTIONS_PIPE = [
  'demande',
  'connecte',
  'message',
  'reponse',
  'sans-reponse',
  'ecarter',
] as const;
const envoiSchema = z.object({ note: z.string().max(2_000) });
const variablesSchema = z.object({
  prenom: z.string().max(200).optional(),
  entreprise: z.string().max(200).optional(),
});

export function registerSalesnavRoutes(app: FastifyInstance, deps: SalesnavRoutesDeps): void {
  const { db, connexionDeps } = deps;

  const erreur = (e: unknown, reply: FastifyReply) => {
    if (e instanceof CampagneIntrouvable || e instanceof ProspectIntrouvable)
      return reply.code(404).send({ error: e.message });
    if (e instanceof ProspectInvalide) return reply.code(400).send({ error: e.message });
    if (e instanceof ActionRefusee || e instanceof EnvoiRefuse || e instanceof DejaEnCours)
      return reply.code(409).send({ error: e.message });
    if (e instanceof ActionInvalide) return reply.code(400).send({ error: e.message });
    if (e instanceof ModeleInvalide || e instanceof ReglageInvalide)
      return reply.code(400).send({ error: e.message });
    throw e;
  };
  const invalide = (reply: FastifyReply, issue?: string) =>
    reply.code(400).send({ error: issue ?? 'Requête invalide' });

  async function dansInstance<T>(
    slug: string,
    reply: FastifyReply,
    fn: Parameters<typeof withInstance<T>>[2],
  ) {
    const instance = await getInstanceBySlug(db, slug);
    if (!instance) return reply.code(404).send({ error: 'Instance inconnue' });
    try {
      return await withInstance(db, instance.id, fn);
    } catch (e) {
      return erreur(e, reply);
    }
  }

  app.get<{ Params: { slug: string } }>('/api/i/:slug/salesnav/reglages', (request, reply) =>
    dansInstance(request.params.slug, reply, (tx) => lireReglages(tx)),
  );

  app.put<{ Params: { slug: string }; Body: unknown }>(
    '/api/i/:slug/salesnav/reglages',
    (request, reply) => {
      const p = reglagesSchema.safeParse(request.body);
      if (!p.success) return invalide(reply, 'Réglage invalide');
      return dansInstance(request.params.slug, reply, (tx) => sauverReglages(tx, p.data));
    },
  );

  // Le pipe : les personnes proposées ou suivies, les statistiques de la campagne et, pour chaque
  // personne, le message à envoyer ensuite (modèle par défaut de sa cible, variables remplies).
  app.get<{ Params: { slug: string } }>('/api/i/:slug/salesnav/pipe', (request, reply) =>
    dansInstance(request.params.slug, reply, async (tx) => {
      const prospects = await listerProspects(tx);
      const stats = await statsPipe(tx);
      const modeles = await listerModeles(tx);
      const disponibles = await disponiblesDansLaBase(tx);
      const envois = await derniersEnvois(tx);
      const alerte = await alerteAcceptation(tx);
      const reglages = await lireReglages(tx);
      const texte = (cible: string | null, etape: string) =>
        modeles.find((m) => m.icp === cible && m.etape === etape)?.texte ?? null;
      return {
        stats,
        disponibles,
        joursAvantRetrait: JOURS_AVANT_RETRAIT,
        envois,
        alerte,
        pause: reglages.pause,
        pauseRaison: reglages.pauseRaison,
        essaiABlanc: reglages.essaiABlanc,
        cibles: [...new Set(modeles.map((m) => m.icp))],
        prospects: prospects.map((p) => {
          const etape =
            p.statut === 'propose'
              ? 'invitation'
              : p.statut === 'connecte'
                ? (['acceptation', 'relance1', 'relance2'][p.nbMessages] ?? null)
                : null;
          const brut = etape ? texte(p.cible, etape) : null;
          return {
            ...p,
            message:
              etape && brut
                ? {
                    etape,
                    ...rendre(brut, {
                      prenom: p.nom.split(' ')[0],
                      entreprise: p.entreprise ?? undefined,
                    }),
                  }
                : null,
          };
        }),
      };
    }),
  );

  app.post<{ Params: { slug: string } }>('/api/i/:slug/salesnav/pipe/proposer', (request, reply) =>
    dansInstance(request.params.slug, reply, (tx) => proposerDuJour(tx)),
  );

  app.post<{ Params: { slug: string }; Body: unknown }>(
    '/api/i/:slug/salesnav/pipe/prospects',
    async (request, reply) => {
      const p = prospectSchema.safeParse(request.body);
      if (!p.success) return invalide(reply, 'Profil invalide');
      const r = await dansInstance(request.params.slug, reply, (tx) => ajouterProspect(tx, p.data));
      return reply.sent ? undefined : reply.code(201).send(r);
    },
  );

  app.patch<{ Params: { slug: string; id: string }; Body: unknown }>(
    '/api/i/:slug/salesnav/pipe/prospects/:id',
    (request, reply) => {
      const p = cibleSchema.safeParse(request.body);
      if (!p.success) return invalide(reply, 'Cible invalide');
      return dansInstance(request.params.slug, reply, async (tx) => {
        await choisirCible(tx, request.params.id, p.data.cible);
        return { ok: true };
      });
    },
  );

  // Envoi par le Chrome du pilote : la demande entre dans la file et la routine est lancée dans la
  // même transaction, donc un refus de l'une annule l'autre.
  app.post<{ Params: { slug: string; id: string }; Body: unknown }>(
    '/api/i/:slug/salesnav/pipe/prospects/:id/envoyer',
    (request, reply) => {
      const p = envoiSchema.safeParse(request.body);
      if (!p.success) return invalide(reply, 'Note invalide');
      return dansInstance(request.params.slug, reply, async (tx) => {
        const envoi = await demanderEnvoi(tx, request.params.id, p.data.note);
        await demanderExecution(tx, 'salesnav', 'pilote');
        return { id: envoi.id, essai: envoi.essai };
      });
    },
  );

  app.post<{ Params: { slug: string; id: string; action: string } }>(
    '/api/i/:slug/salesnav/pipe/prospects/:id/:action',
    async (request, reply) => {
      const { id, action } = request.params;
      if (!(ACTIONS_PIPE as readonly string[]).includes(action))
        return reply.code(404).send({ error: 'Action inconnue' });
      const instance = await getInstanceBySlug(db, request.params.slug);
      if (!instance) return reply.code(404).send({ error: 'Instance inconnue' });
      try {
        const avant = await withInstance(db, instance.id, async (tx) => {
          if (action === 'demande') await marquerDemandeEnvoyee(tx, id);
          else if (action === 'connecte') await marquerConnecte(tx, id);
          else if (action === 'message') await enregistrerMessage(tx, id);
          else if (action === 'reponse') return marquerReponse(tx, id);
          else if (action === 'sans-reponse') await marquerSansReponse(tx, id);
          else await ecarter(tx, id);
          return null;
        });
        // À la première réponse, la personne devient une opportunité du Radar (canal SalesNav).
        let opportuniteCreee = false;
        if (avant && !avant.opportuniteId) {
          const [prenom, ...reste] = avant.nom.split(' ');
          try {
            const r = await ajouterAuRadar(
              db,
              instance,
              {
                prenom: reste.length ? prenom : null,
                nom: reste.length ? reste.join(' ') : (prenom ?? avant.nom),
                entreprise: avant.entreprise,
                fonction: avant.fonction,
                lienLinkedin: avant.lienLinkedin,
                origine: 'SalesNav',
                canal: 'SalesNav',
                etape: 3,
                note: 'Réponse reçue sur Sales Navigator.',
              },
              connexionDeps,
            );
            if ('id' in r) {
              await withInstance(db, instance.id, (tx) => lierOpportunite(tx, id, r.id));
              opportuniteCreee = true;
            }
          } catch (e) {
            request.log.warn({ err: e }, 'Opportunité SalesNav non créée');
          }
        }
        return { ok: true, opportuniteCreee };
      } catch (e) {
        return erreur(e, reply);
      }
    },
  );

  // Les compteurs du jour et de la semaine : sous-section SalesNav et barre de l'état commercial.
  app.get<{ Params: { slug: string } }>('/api/i/:slug/salesnav/indicateurs', (request, reply) =>
    dansInstance(request.params.slug, reply, (tx) => indicateurs(tx)),
  );

  app.post<{ Params: { slug: string }; Body: unknown }>(
    '/api/i/:slug/salesnav/actions',
    async (request, reply) => {
      const p = actionSchema.safeParse(request.body);
      if (!p.success) return invalide(reply, 'Action invalide');
      const r = await dansInstance(request.params.slug, reply, async (tx) => {
        await enregistrerAction(tx, p.data);
        return indicateurs(tx);
      });
      return reply.sent ? undefined : reply.code(201).send(r);
    },
  );

  // Tout ce que l'écran affiche : étapes, limite, modèles par défaut, campagnes et leurs surcharges.
  app.get<{ Params: { slug: string } }>('/api/i/:slug/salesnav/modeles', (request, reply) =>
    dansInstance(request.params.slug, reply, async (tx) => ({
      etapes: ETAPES_SALESNAV,
      limiteInvitation: LIMITE_INVITATION,
      modeles: await listerModeles(tx),
      campagnes: await listerCampagnes(tx),
    })),
  );

  app.put<{ Params: { slug: string; icp: string; etape: string }; Body: unknown }>(
    '/api/i/:slug/salesnav/modeles/:icp/:etape',
    (request, reply) => {
      const p = texteSchema.safeParse(request.body);
      if (!p.success) return invalide(reply, p.error.issues[0]?.message);
      return dansInstance(request.params.slug, reply, async (tx) => {
        await sauverModele(tx, request.params.icp, request.params.etape, p.data.texte);
        return { ok: true };
      });
    },
  );

  app.post<{ Params: { slug: string }; Body: unknown }>(
    '/api/i/:slug/salesnav/campagnes',
    async (request, reply) => {
      const p = campagneSchema.safeParse(request.body);
      if (!p.success) return invalide(reply, p.error.issues[0]?.message);
      const c = await dansInstance(request.params.slug, reply, (tx) => creerCampagne(tx, p.data));
      return reply.sent ? undefined : reply.code(201).send(c);
    },
  );

  app.delete<{ Params: { slug: string; id: string } }>(
    '/api/i/:slug/salesnav/campagnes/:id',
    (request, reply) =>
      dansInstance(request.params.slug, reply, async (tx) => {
        await supprimerCampagne(tx, request.params.id);
        return { ok: true };
      }),
  );

  app.put<{ Params: { slug: string; id: string; etape: string }; Body: unknown }>(
    '/api/i/:slug/salesnav/campagnes/:id/modeles/:etape',
    (request, reply) => {
      const p = texteSchema.safeParse(request.body);
      if (!p.success) return invalide(reply, p.error.issues[0]?.message);
      return dansInstance(request.params.slug, reply, async (tx) => {
        await sauverSurcharge(tx, request.params.id, request.params.etape, p.data.texte);
        return { ok: true };
      });
    },
  );

  app.delete<{ Params: { slug: string; id: string; etape: string } }>(
    '/api/i/:slug/salesnav/campagnes/:id/modeles/:etape',
    (request, reply) =>
      dansInstance(request.params.slug, reply, async (tx) => {
        await retirerSurcharge(tx, request.params.id, request.params.etape);
        return { ok: true };
      }),
  );

  // Le message prêt à copier pour un contact : texte de la campagne ou du modèle, variables remplies.
  app.post<{ Params: { slug: string; id: string; etape: string }; Body: unknown }>(
    '/api/i/:slug/salesnav/campagnes/:id/messages/:etape',
    (request, reply) => {
      const p = variablesSchema.safeParse(request.body ?? {});
      if (!p.success) return invalide(reply, p.error.issues[0]?.message);
      return dansInstance(request.params.slug, reply, async (tx) => {
        const m = await messageEffectif(tx, request.params.id, request.params.etape);
        return { origine: m.origine, ...rendre(m.texte, p.data) };
      });
    },
  );
}
