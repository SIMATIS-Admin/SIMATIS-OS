import { EVENEMENTS_DONNEE } from 'os-agents-relay';
import { z } from 'zod';
import { registerTool, type ToolCtx } from '../mcp/tools.js';
import { propose } from '../propositions/service.js';
import { ETATS_MISSION, OBJETS_PARTAGE } from './schema.js';
import {
  listerPartenaires,
  missionsRecentes,
  PartenaireRefuse,
  trouverPartenaire,
} from './service.js';
import './types-propositions.js';

const ctxProposition = (ctx: ToolCtx) => ({
  instance: ctx.instance,
  realWrites: ctx.deps.realWrites,
  secretsDir: ctx.deps.secretsDir,
});

// What the agent gets back: the mission (applied) or the proposal waiting in the Inbox.
const issue = (p: { id: string; statut: string; resultat: unknown }) =>
  p.statut === 'proposee'
    ? { proposition: p.id, statut: 'en attente de validation dans l’Inbox' }
    : p.statut === 'echec'
      ? { proposition: p.id, statut: 'echec', resultat: p.resultat }
      : { proposition: p.id, statut: p.statut, ...(p.resultat as Record<string, unknown>) };

const partenaire = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .describe('Nom (ou partie du nom) ou identifiant du partenaire, voir missions_partenaires');

registerTool({
  name: 'confier_mission',
  description:
    "Confie une mission à l'agent d'un OS partenaire (ex. Alpes OS de Christophe : « un livre blanc sur … »). Le partenaire reçoit la consigne, le titre et le contexte TELS QUELS : n'y mettre que ce qui le concerne, rien de confidentiel sur les autres clients. Selon le niveau d'autonomie, la mission part tout de suite ou attend la validation de Marc dans l'Inbox. Écritures réelles fermées : la mission reste en « simulation », rien ne part.",
  input: z.object({
    partenaire,
    consigne: z.string().trim().min(1).max(10_000).describe('Ce que le partenaire doit faire'),
    titre: z.string().trim().min(1).max(200).optional().describe('Titre court de la mission'),
    contexte: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Données jointes (objet JSON), envoyées telles quelles'),
  }),
  scope: 'instance',
  handler: async (ctx, input) => {
    const p = await trouverPartenaire(ctx.tx, input.partenaire);
    const proposition = await propose(ctx.tx, ctxProposition(ctx), {
      type: 'partenaire.mission',
      auteur: ctx.acteur,
      contenu: {
        partenaireId: p.id,
        consigne: input.consigne,
        // A title the Inbox can show when the mission waits for validation.
        titre: input.titre ?? input.consigne.split('\n')[0]?.slice(0, 80) ?? null,
        contexte: input.contexte ?? null,
      },
    });
    return { partenaire: p.nom, ...issue(proposition) };
  },
});

registerTool({
  name: 'missions_partenaires',
  description:
    'Les OS partenaires connectés (nom, statut, ce qu’ils voient) et les missions qui leur ont été confiées : titre, partenaire, état (simulation, submitted, working, input-required, completed, failed, canceled, rejected), dernier message, résultat, dates.',
  input: z.object({
    partenaire: partenaire.optional(),
    etat: z.enum(ETATS_MISSION).optional(),
    limite: z.number().int().min(1).max(100).default(20),
  }),
  scope: 'instance',
  handler: async ({ tx }, { partenaire: nom, etat, limite }) => {
    const tous = await listerPartenaires(tx);
    let partenaireId: string | undefined;
    if (nom) {
      const trouves = tous.filter(
        (p) => p.id === nom || p.nom.toLowerCase().includes(nom.toLowerCase()),
      );
      if (trouves.length !== 1) throw new PartenaireRefuse(`Partenaire inconnu ou ambigu : ${nom}`);
      partenaireId = trouves[0]?.id;
    }
    return {
      partenaires: tous.map((p) => ({
        id: p.id,
        nom: p.nom,
        statut: p.statut,
        voit: p.partage,
        connecteDepuis: p.createdAt,
      })),
      missions: await missionsRecentes(tx, {
        limite,
        ...(partenaireId ? { partenaireId } : {}),
        ...(etat ? { etat } : {}),
      }),
    };
  },
});

registerTool({
  name: 'envoyer_donnee',
  description:
    "Pousse un fait du suivi commercial à un OS partenaire, quand Marc le demande : prospect, rendez-vous, affaire ou compte rendu, créé, modifié, gagné ou perdu. Refusé si le partenaire ne voit pas ce type de données (réglage Paramètres > Partenaires). Les champs partent TELS QUELS : n'y mettre que ce que le partenaire doit savoir. `ref` = identifiant stable dans SIMATIS OS (même ref = même fiche chez le partenaire).",
  input: z.object({
    partenaire,
    objet: z.enum(OBJETS_PARTAGE),
    evenement: z.enum(EVENEMENTS_DONNEE),
    ref: z.string().trim().min(1).max(200),
    champs: z
      .record(z.string(), z.union([z.string().max(5_000), z.number(), z.boolean(), z.null()]))
      .describe('Valeurs simples : entreprise, ville, etape, date, resume…'),
  }),
  scope: 'instance',
  handler: async (ctx, input) => {
    const p = await trouverPartenaire(ctx.tx, input.partenaire);
    if (!p.partage.includes(input.objet)) {
      throw new PartenaireRefuse(
        `${p.nom} ne voit pas les données « ${input.objet} » (il voit : ${p.partage.join(', ') || 'rien'}).`,
      );
    }
    const proposition = await propose(ctx.tx, ctxProposition(ctx), {
      type: 'partenaire.donnee',
      auteur: ctx.acteur,
      contenu: {
        partenaireId: p.id,
        objet: input.objet,
        evenement: input.evenement,
        ref: input.ref,
        champs: input.champs,
      },
    });
    return { partenaire: p.nom, ...issue(proposition) };
  },
});
