import { deposer, lireMission, messageLibre, mission } from 'os-agents-relay';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Kind } from '../crm/fiches.js';
import { ecrireHubspot, ligne, viaHubspot } from '../crm/liens.js';
import { activites, rendezVous, taches } from '../crm/schema.js';
import { supprimerLocalement, verifierSansBloquant } from '../crm/suppression.js';
import type { Tx } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { sujets } from '../inbox/schema.js';
import { logEvent } from '../journal/service.js';
import { registerPropositionType } from '../propositions/registry.js';
import { crmPartages, messagesPartenaires, missions, OBJETS_CRM, TYPES_MESSAGE } from './schema.js';
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

const enAttente = async (tx: Tx, id: string) => {
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
    const m = messageLibre({
      type: c.type,
      sujet: c.sujet,
      texte: c.texte,
      ...(c.enReponseA ? { en_reponse_a: c.enReponseA } : {}),
    });
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

// A record the partner deleted: never deleted here alone (fixed safeguard). Validated by Marc, it
// is deleted like from its page (in HubSpot first for a HubSpot record); set aside, it stays here,
// out of the share.
export const suppressionPartenaire = z.object({
  partenaireId: z.uuid(),
  objet: z.enum(OBJETS_CRM),
  localId: z.uuid(),
  titre: z.string().max(400),
});

const FICHES: Partial<Record<(typeof OBJETS_CRM)[number], Kind>> = {
  entreprise: 'entreprise',
  contact: 'contact',
  affaire: 'affaire',
};

registerPropositionType({
  type: 'partenaire.suppression',
  action: 'partenaire',
  schema: suppressionPartenaire,
  apply: async (tx, c, ctx) => {
    const kind = FICHES[c.objet];
    if (kind) {
      const ref = { kind, id: c.localId };
      const l = await ligne(tx, kind, c.localId);
      if (!l) throw new PartenaireRefuse('Fiche déjà supprimée.');
      await verifierSansBloquant(tx, ref);
      if (await viaHubspot(tx, l, l)) {
        const simulation = await ecrireHubspot(
          tx,
          ctx.instance,
          'record.archive',
          { kind, id: c.localId },
          ctx.deps,
        );
        if (simulation) return { simulation: true };
      }
      await supprimerLocalement(tx, ref);
    } else {
      const t = { tache: taches, rendez_vous: rendezVous, activite: activites }[
        c.objet as 'tache' | 'rendez_vous' | 'activite'
      ];
      const [row] = await tx
        .select({ source: t.source })
        .from(t)
        .where(and(eq(t.instanceId, currentInstance), eq(t.id, c.localId)));
      if (!row) throw new PartenaireRefuse('Fiche déjà supprimée.');
      if (row.source === 'hubspot') {
        throw new PartenaireRefuse('Tâche copiée de HubSpot : à supprimer dans HubSpot.');
      }
      if (c.objet === 'tache')
        await tx
          .update(sujets)
          .set({ tacheId: null })
          .where(and(eq(sujets.instanceId, currentInstance), eq(sujets.tacheId, c.localId)));
      await tx.delete(t).where(and(eq(t.instanceId, currentInstance), eq(t.id, c.localId)));
    }
    await tx
      .delete(crmPartages)
      .where(
        and(
          eq(crmPartages.instanceId, currentInstance),
          eq(crmPartages.partenaireId, c.partenaireId),
          eq(crmPartages.localId, c.localId),
        ),
      );
    await logEvent(tx, {
      acteur: 'pilote',
      action: `Fiche supprimée après sa suppression chez un partenaire (${c.objet})`,
      niveau: 'L1',
    });
    return { supprimee: c.localId };
  },
});
