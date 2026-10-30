import { deposer, donnee, EVENEMENTS_DONNEE, lireMission, mission } from 'os-agents-relay';
import { z } from 'zod';
import { currentInstance } from '../db/columns.js';
import { logEvent } from '../journal/service.js';
import { registerPropositionType } from '../propositions/registry.js';
import { donneesEnvoyees, missions, OBJETS_PARTAGE } from './schema.js';
import { PartenaireRefuse, partenaireActif } from './service.js';
import { stockageTx } from './stockage.js';

export const missionPartenaire = z.object({
  partenaireId: z.uuid(),
  titre: z.string().trim().min(1).max(200).nullish(),
  consigne: z.string().trim().min(1).max(10_000),
  contexte: z.record(z.string(), z.unknown()).nullish(),
});

export const donneePartenaire = z.object({
  partenaireId: z.uuid(),
  objet: z.enum(OBJETS_PARTAGE),
  evenement: z.enum(EVENEMENTS_DONNEE),
  ref: z.string().trim().min(1).max(200),
  champs: z.record(z.string(), z.union([z.string().max(5_000), z.number(), z.boolean(), z.null()])),
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

// A fact of the sales follow-up, only for what the partner is allowed to see.
registerPropositionType({
  type: 'partenaire.donnee',
  action: 'partenaire',
  schema: donneePartenaire,
  apply: async (tx, c, ctx) => {
    const p = await partenaireActif(tx, c.partenaireId);
    if (!p.partage.includes(c.objet)) {
      throw new PartenaireRefuse(`${p.nom} ne voit pas les données « ${c.objet} ».`);
    }
    if (!ctx.reel) {
      await logEvent(tx, {
        acteur: ctx.proposition.auteur,
        action: `Donnée pour ${p.nom} (simulation) : ${c.objet} ${c.evenement}`,
      });
      return { simulation: true };
    }
    const sortie = await deposer({
      stockage: stockageTx(tx),
      connexion: p.connexionId,
      type: 'donnee',
      corps: donnee({ objet: c.objet, evenement: c.evenement, ref: c.ref, champs: c.champs }),
    });
    await tx.insert(donneesEnvoyees).values({
      id: sortie.id,
      instanceId: currentInstance,
      partenaireId: p.id,
      objet: c.objet,
      evenement: c.evenement,
      ref: c.ref,
      champs: c.champs,
      propositionId: ctx.proposition.id,
      envoyeePar: ctx.proposition.auteur,
    });
    await logEvent(tx, {
      acteur: ctx.proposition.auteur,
      action: `Donnée envoyée à ${p.nom} : ${c.objet} ${c.evenement}`,
      details: { enveloppe: sortie.id },
    });
    return { envoyee: sortie.id };
  },
});
