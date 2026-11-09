import type { ClientIA } from '../enrichissement/client.js';
import { z } from 'zod';
import { criteresValides, type Criteres } from './criteres.js';

const reponse = z.object({
  resume: z.string(),
  q: z.string().nullish(),
  secteurs: z.array(z.object({ code: z.string(), libelle: z.string() })),
  departements: z.array(z.string()),
  effectifs: z.array(z.string()),
  categories: z.array(z.string()),
  caMin: z.number().nullish(),
  caMax: z.number().nullish(),
  nonTraites: z.array(z.string()),
});

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'resume',
    'q',
    'secteurs',
    'departements',
    'effectifs',
    'categories',
    'caMin',
    'caMax',
    'nonTraites',
  ],
  properties: {
    resume: { type: 'string' },
    q: { type: ['string', 'null'] },
    secteurs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'libelle'],
        properties: { code: { type: 'string' }, libelle: { type: 'string' } },
      },
    },
    departements: { type: 'array', items: { type: 'string' } },
    effectifs: { type: 'array', items: { type: 'string' } },
    categories: { type: 'array', items: { type: 'string' } },
    caMin: { type: ['number', 'null'] },
    caMax: { type: ['number', 'null'] },
    nonTraites: { type: 'array', items: { type: 'string' } },
  },
};

const CONSIGNE = `Tu traduis une demande de prospection en critères pour l'annuaire des entreprises françaises.
- secteurs : divisions NAF rév. 2 à 2 chiffres (ex. "25" fabrication de produits métalliques, "28" machines, "62" informatique) ou codes exacts (ex. "25.62B"), avec un libellé court en français. Préfère la division sauf si la demande vise un code précis.
- departements : numéros de département ("69", "01", "2A"). Une région ou une ville se traduit par ses départements.
- effectifs : codes de tranche INSEE parmi NN (sans salarié), 00 (0), 01 (1-2), 02 (3-5), 03 (6-9), 11 (10-19), 12 (20-49), 21 (50-99), 22 (100-199), 31 (200-249), 32 (250-499), 41 (500-999), 42 (1000-1999), 51 (2000-4999), 52 (5000-9999), 53 (10000+).
- categories : PME, ETI ou GE.
- caMin, caMax : chiffre d'affaires en euros, ou null.
- q : mots-clés du nom ou de l'activité si la demande en contient, sinon une chaîne vide.
- nonTraites : ce que l'annuaire ne sait pas filtrer (croissance, poste vacant, outils utilisés, absence d'un dirigeant…), cité tel que dans la demande.
- resume : une phrase qui redit la recherche telle que tu l'as comprise.
N'invente aucune valeur : laisse une liste vide quand la demande ne dit rien.`;

export type Interpretation = { criteres: Criteres; nonTraites: string[]; resume: string };

export class DemandeRefusee extends Error {}

export async function interpreter(client: ClientIA, demande: string): Promise<Interpretation> {
  const texte = demande.trim();
  if (!texte) throw new DemandeRefusee('Décrivez les entreprises que vous cherchez.');
  const { json } = await client.demander({ consigne: CONSIGNE, entree: texte, schema: SCHEMA });
  const lu = reponse.safeParse(json);
  if (!lu.success) throw new DemandeRefusee('Réponse de l’IA illisible : reformulez la demande.');
  const { resume, nonTraites, ...brut } = lu.data;
  return { criteres: criteresValides(brut), nonTraites, resume };
}
