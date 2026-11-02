import { z } from 'zod';
import { normaliserEmail, normaliserTelephone, texte } from '../base-vivante/nettoyage.js';
import { CONFIANCES, MODES_EMAIL, type Suggestion, type TypeEnrichissement } from './schema.js';

export type Candidat = Pick<
  Suggestion,
  'prenom' | 'nom' | 'fonction' | 'email' | 'telephone' | 'sourceUrl' | 'confiance' | 'modeEmail'
>;

export type FicheAEnrichir = {
  entreprise: string;
  domaine: string | null;
  prenom: string | null;
  nom: string | null;
  fonction: string | null;
  email: string | null;
  telephone: string | null;
};

export class ErreurAnalyse extends Error {}

const nullable = { type: ['string', 'null'] } as const;
// Mode strict d'OpenAI : tous les champs sont requis, l'inconnu se dit par null.
export const SCHEMA_REPONSE = {
  type: 'object',
  additionalProperties: false,
  required: ['contacts'],
  properties: {
    contacts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'prenom',
          'nom',
          'fonction',
          'email',
          'telephone',
          'sourceUrl',
          'confiance',
          'modeEmail',
        ],
        properties: {
          prenom: nullable,
          nom: nullable,
          fonction: nullable,
          email: nullable,
          telephone: nullable,
          sourceUrl: nullable,
          confiance: { type: 'string', enum: [...CONFIANCES] },
          modeEmail: { type: ['string', 'null'], enum: [...MODES_EMAIL, null] },
        },
      },
    },
  },
} as const;

const REGLES = `Règles : ne fournis que des informations trouvées sur des pages web publiques, avec l'URL exacte de la page (sourceUrl) ; n'invente jamais un nom, un mail ou un téléphone, mets null à la place. Si tu proposes une adresse mail construite par déduction (prénom.nom@domaine), mets modeEmail à "deduit" ; si elle figure sur une page, mets "trouve". Ne scrape pas LinkedIn : cite seulement les pages publiques que la recherche web remonte. Réponds uniquement par le JSON demandé.`;

export function consigne(
  type: TypeEnrichissement,
  profil: string[],
  maxParEntreprise: number,
): string {
  const tache =
    type === 'contacts'
      ? `Trouve au plus ${maxParEntreprise} personne(s) de l'entreprise indiquée dont la fonction correspond à : ${profil.join(', ')}.`
      : `Complète le mail et le téléphone de la personne déjà connue indiquée, qui travaille dans l'entreprise indiquée. Ne renvoie que cette même personne, au plus ${maxParEntreprise} résultat.`;
  return `${tache}\n${REGLES}`;
}

export function entree(f: FicheAEnrichir): string {
  const personne = [f.prenom, f.nom].filter(Boolean).join(' ');
  return [
    `Entreprise : ${f.entreprise}`,
    f.domaine ? `Site ou domaine : ${f.domaine}` : null,
    personne ? `Contact déjà connu : ${personne}` : null,
    f.fonction ? `Fonction connue : ${f.fonction}` : null,
    f.email ? `Mail connu : ${f.email}` : null,
    f.telephone ? `Téléphone connu : ${f.telephone}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

const reponseSchema = z.object({
  contacts: z.array(
    z.object({
      prenom: z.string().nullable(),
      nom: z.string().nullable(),
      fonction: z.string().nullable(),
      email: z.string().nullable(),
      telephone: z.string().nullable(),
      sourceUrl: z.string().nullable(),
      confiance: z.enum(CONFIANCES),
      modeEmail: z.enum(MODES_EMAIL).nullable(),
    }),
  ),
});

const cle = (c: Candidat) =>
  [c.prenom, c.nom]
    .map((v) =>
      (v ?? '')
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase(),
    )
    .join('|');
const remplissage = (c: Candidat) =>
  [c.prenom, c.nom, c.fonction, c.email, c.telephone].filter(Boolean).length;

export function analyserReponse(json: unknown, max: number): Candidat[] {
  const lu = reponseSchema.safeParse(json);
  if (!lu.success) throw new ErreurAnalyse('Réponse hors schéma');
  const parPersonne = new Map<string, Candidat>();
  for (const brut of lu.data.contacts) {
    const url = texte(brut.sourceUrl);
    const sourcee = url !== null && url.startsWith('https://') && URL.canParse(url);
    // normaliserEmail garde le dernier morceau d'un texte à espaces : on refuse « a b@x.test ».
    const email = /\s/.test(texte(brut.email) ?? '') ? null : normaliserEmail(brut.email);
    const c: Candidat = {
      prenom: texte(brut.prenom),
      nom: texte(brut.nom),
      fonction: texte(brut.fonction),
      email,
      // Sans page https derrière, un téléphone n'est pas retenu et un mail reste une simple déduction.
      telephone: sourcee ? normaliserTelephone(brut.telephone) : null,
      sourceUrl: sourcee ? url : null,
      confiance: sourcee ? brut.confiance : 'basse',
      modeEmail: !email ? null : sourcee ? (brut.modeEmail ?? 'trouve') : 'deduit',
    };
    if (!c.nom && !c.email && !c.telephone) continue;
    const existant = parPersonne.get(cle(c));
    if (!existant || remplissage(c) > remplissage(existant)) parPersonne.set(cle(c), c);
  }
  return [...parPersonne.values()].slice(0, max);
}
