import { z } from 'zod';
import type { CleRoutine } from './schema.js';

// The four routines of the mockup (data.js routinesStd, v-plateforme.js PARAMS_DEF): what each one
// does, the Claude skill that runs it, and the settings the pilot changes without touching the skill.
export const HEURES = ['6h00', '6h30', '7h00', '7h30', '8h00', '8h30', '9h00'] as const;
const JOURS = ['Jours ouvrés', 'Du lundi au jeudi', 'Tous les jours'] as const;
const PLAGES = [
  '9h30-12h00 et 14h00-17h00',
  '9h00-12h00 seulement',
  '14h00-18h00 seulement',
] as const;
const DECLENCHEMENTS = [
  'Après chaque envoi de relances',
  'Chaque jour à 18h00',
  'À la demande seulement',
] as const;

export const paramsSchemas = {
  quotidienne: z.object({
    heure: z.enum(HEURES),
    jours: z.enum(JOURS),
    canaux: z.array(z.enum(['email', 'appel'])).max(2),
    retard: z.number().int().min(0).max(90),
    max: z.number().int().min(1).max(50),
    creneaux: z.number().int().min(0).max(3),
    delai: z.number().int().min(1).max(15),
    plages: z.enum(PLAGES),
  }),
  nettoyage: z.object({
    declenchement: z.enum(DECLENCHEMENTS),
    suivi: z.number().int().min(1).max(60),
  }),
  hebdo: z.object({
    jour: z.enum(['Lundi', 'Vendredi']),
    heure: z.enum(HEURES),
  }),
  evenement: z.object({
    devis: z.number().int().min(3).max(30),
    stop: z.boolean(),
  }),
} satisfies Record<CleRoutine, z.ZodObject>;

export type ParamsQuotidienne = z.infer<typeof paramsSchemas.quotidienne>;

export const PARAMS_DEFAUT: { [K in CleRoutine]: z.infer<(typeof paramsSchemas)[K]> } = {
  quotidienne: {
    heure: '7h00',
    jours: 'Jours ouvrés',
    max: 20,
    canaux: ['email', 'appel'],
    retard: 30,
    creneaux: 3,
    delai: 3,
    plages: '9h30-12h00 et 14h00-17h00',
  },
  nettoyage: { declenchement: 'Après chaque envoi de relances', suivi: 21 },
  hebdo: { jour: 'Lundi', heure: '8h00' },
  evenement: { devis: 10, stop: true },
};

export const ROUTINES: { cle: CleRoutine; nom: string; skill: string; etapes: string[] }[] = [
  {
    cle: 'quotidienne',
    nom: 'Routine quotidienne de relance',
    skill: 'relance-quotidienne',
    etapes: [
      'Lire les tâches de relance échues et du jour',
      "Vérifier l'historique de messagerie de chaque contact",
      "Chercher des créneaux libres dans l'agenda",
      'Rédiger les brouillons, à valider',
      "Préparer les fiches et le planning d'appels",
      'Produire le brief du jour',
    ],
  },
  {
    cle: 'nettoyage',
    nom: 'Nettoyage des tâches après relance',
    skill: 'nettoyage-taches',
    etapes: [
      'Constater dans la messagerie les relances réellement envoyées',
      'Clôturer les tâches correspondantes',
      'Proposer les tâches de suivi à recréer, à valider',
    ],
  },
  {
    cle: 'hebdo',
    nom: 'Revue hebdomadaire',
    skill: 'revue-hebdomadaire',
    etapes: [
      'Relire le pipeline par niveau de score',
      'Lister les devis à relancer et les causes de perte',
      'Proposer des notes pour le second cerveau',
    ],
  },
  {
    cle: 'evenement',
    nom: 'Sur événement',
    skill: 'sur-evenement',
    etapes: [
      'Qualifier le nouveau lead',
      "Arrêter la séquence dès qu'un contact répond",
      "Préparer la relance d'un devis sans réponse",
    ],
  },
];

export const CLES = ROUTINES.map((r) => r.cle);

// Stored settings may predate a field or carry an old value: fall back on the defaults.
export function paramsOf<K extends CleRoutine>(cle: K, stored: unknown) {
  const merged = { ...PARAMS_DEFAUT[cle], ...(stored as object) };
  const parsed = paramsSchemas[cle].safeParse(merged);
  return (parsed.success ? parsed.data : PARAMS_DEFAUT[cle]) as z.infer<(typeof paramsSchemas)[K]>;
}

// "Chaque jour ouvré à 7h00, ou à la demande" (mockup rythme()).
export function rythme(cle: CleRoutine, params: Record<string, unknown>): string {
  if (cle === 'quotidienne') {
    const p = paramsOf('quotidienne', params);
    const jours = p.jours === 'Jours ouvrés' ? 'Chaque jour ouvré' : p.jours;
    return `${jours} à ${p.heure}, ou à la demande`;
  }
  if (cle === 'nettoyage') return paramsOf('nettoyage', params).declenchement;
  if (cle === 'hebdo') {
    const p = paramsOf('hebdo', params);
    return `${p.jour} à ${p.heure}`;
  }
  return 'Nouveau lead, réponse reçue, devis sans réponse';
}
