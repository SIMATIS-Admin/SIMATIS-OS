import { deposer, lireMission, mission } from 'os-agents-relay';
import { z } from 'zod';
import { currentInstance } from '../db/columns.js';
import { logEvent } from '../journal/service.js';
import { registerPropositionType } from '../propositions/registry.js';
import { messageLibre } from './messages.js';
import { messagesPartenaires, missions, TYPES_MESSAGE } from './schema.js';
import { missionRecue, PartenaireRefuse, partenaireActif, repondreMission } from './service.js';
import { stockageTx } from './stockage.js';

export const missionPartenaire = z.object({
  partenaireId: z.uuid(),
  titre: z.string().trim().min(1).max(200).nullish(),
  consigne: z.string().trim().min(1).max(10_000),
  contexte: z.record(z.string(), z.unknown()).nullish(),
});

// A mission received from a partner, at L0 or L1: validate = accept it, set aside = refuse it.
// The title and the instruction are only there for the Inbox to show.
export const missionRecueSchema = z.object({
  missionId: z.string().min(1).max(200),
  partenaire: z.string().max(200),
  titre: z.string().max(400),
  consigne: z.string().max(10_000),
});

// What the agent answers to a received mission once accepted: done, a question, refused, failed.
export const ETATS_REPONSE = ['completed', 'input-required', 'rejected', 'failed'] as const;
export const reponseMission = z.object({
  missionId: z.string().min(1).max(200),
  titre: z.string().max(400),
  etat: z.enum(ETATS_REPONSE),
  message: z.string().trim().min(1).max(10_000),
  resultat: z.record(z.string(), z.unknown()).nullish(),
});

export const messagePartenaire = z.object({
  partenaireId: z.uuid(),
  // Shown in the Inbox while the message waits for validation.
  partenaire: z.string().max(200).nullish(),
  type: z.enum(TYPES_MESSAGE),
  sujet: z.string().trim().min(1).max(200),
  texte: z.string().trim().min(1).max(20_000),
  enReponseA: z.string().trim().min(1).max(200).nullish(),
});

// A mission entrusted to a partner OS. Real writes closed: it is recorded as `simulation` and
// nothing is queued for the relay.
registerPropositionType({
  type: 'partenaire.mission',
  action: 'partenaire',
  schema: missionPartenaire,
  apply: async (tx, c, ctx) => {
    const p = await partenaireActif(tx, c.partenaireId);
    const m = mission({
      consigne: c.consigne,
      ...(c.titre ? { titre: c.titre } : {}),
      ...(c.contexte ? { contexte: c.contexte } : {}),
    });
    const sortie = ctx.reel
      ? await deposer({
          stockage: stockageTx(tx),
          connexion: p.connexionId,
          type: 'mission',
          corps: m,
        })
      : null;
    const etat = ctx.reel ? 'submitted' : 'simulation';
    const titre = lireMission(m).titre;
    await tx.insert(missions).values({
      id: m.id,
      instanceId: currentInstance,
      partenaireId: p.id,
      sens: 'envoyee',
      titre,
      consigne: c.consigne,
      contexte: c.contexte ?? null,
      etat,
      contextId: m.contextId,
      historique: [
        { etat, at: new Date().toISOString(), message: null, enveloppe: sortie?.id ?? null },
      ],
      propositionId: ctx.proposition.id,
      confieePar: ctx.proposition.auteur,
    });
    await logEvent(tx, {
      acteur: ctx.proposition.auteur,
      action: `Mission confiée à ${p.nom}${ctx.reel ? '' : ' (simulation)'} : « ${titre} »`,
      details: { mission: m.id },
    });
    return { mission: m.id, etat, titre };
  },
});

const enAttente = async (tx: Parameters<typeof missionRecue>[0], id: string) => {
  const m = await missionRecue(tx, id);
  if (m.etat !== 'submitted') throw new PartenaireRefuse(`Mission déjà traitée (${m.etat}).`);
  return m;
};

registerPropositionType({
  type: 'partenaire.mission_recue',
  action: 'partenaire',
  schema: missionRecueSchema,
  apply: async (tx, c, ctx) => {
    const m = await repondreMission(
      tx,
      ctx.reel,
      await enAttente(tx, c.missionId),
      { etat: 'working', message: 'Mission acceptée.' },
      'pilote',
    );
    return { mission: m.id, etat: m.etat };
  },
  ecarter: async (tx, c, ctx) => {
    await repondreMission(
      tx,
      ctx.reel,
      await enAttente(tx, c.missionId),
      { etat: 'rejected', message: 'Mission refusée.' },
      'pilote',
    );
  },
});

registerPropositionType({
  type: 'partenaire.reponse',
  action: 'partenaire',
  schema: reponseMission,
  apply: async (tx, c, ctx) => {
    const m = await missionRecue(tx, c.missionId);
    if (!['submitted', 'working', 'input-required'].includes(m.etat)) {
      throw new PartenaireRefuse(`Mission déjà close (${m.etat}).`);
    }
    if (m.etat === 'submitted' && c.etat !== 'rejected') {
      throw new PartenaireRefuse('Mission pas encore acceptée : validez-la d’abord dans l’Inbox.');
    }
    const apres = await repondreMission(
      tx,
      ctx.reel,
      m,
      { etat: c.etat, message: c.message, resultat: c.resultat ?? null },
      ctx.proposition.auteur,
    );
    return { mission: apres.id, etat: apres.etat, ...(ctx.reel ? {} : { simulation: true }) };
  },
});

registerPropositionType({
  type: 'partenaire.message',
  action: 'partenaire',
  schema: messagePartenaire,
  apply: async (tx, c, ctx) => {
    const p = await partenaireActif(tx, c.partenaireId);
    const m = messageLibre(c);
    const sortie = ctx.reel
      ? await deposer({
          stockage: stockageTx(tx),
          connexion: p.connexionId,
          type: 'message',
          corps: m,
        })
      : null;
    await tx.insert(messagesPartenaires).values({
      id: m.messageId,
      instanceId: currentInstance,
      partenaireId: p.id,
      sens: 'envoye',
      type: c.type,
      sujet: c.sujet,
      texte: c.texte,
      enReponseA: c.enReponseA ?? null,
      simulation: !ctx.reel,
      propositionId: ctx.proposition.id,
      envoyePar: ctx.proposition.auteur,
    });
    await logEvent(tx, {
      acteur: ctx.proposition.auteur,
      action: `Message à ${p.nom}${ctx.reel ? '' : ' (simulation)'} : ${c.sujet}`,
      details: { message: m.messageId, ...(sortie ? { enveloppe: sortie.id } : {}) },
    });
    return { message: m.messageId, ...(ctx.reel ? {} : { simulation: true }) };
  },
});
