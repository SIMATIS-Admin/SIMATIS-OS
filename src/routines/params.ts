import { z } from 'zod';
import type { CleRoutine } from './schema.js';

// The four routines of the mockup, plus the Inbox one (data.js routinesStd, v-plateforme.js PARAMS_DEF): what each one
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

const DECLENCHEMENTS_BASE = [
  'Après chaque rapprochement de boîte mail',
  'À la demande seulement',
] as const;

export const paramsSchemas = {
  inbox: z.object({
    heure: z.enum(HEURES),
    jours: z.enum(JOURS),
  }),
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
  base: z.object({
    declenchement: z.enum(DECLENCHEMENTS_BASE),
  }),
} satisfies Record<CleRoutine, z.ZodObject>;

export type ParamsQuotidienne = z.infer<typeof paramsSchemas.quotidienne>;

export const PARAMS_DEFAUT: { [K in CleRoutine]: z.infer<(typeof paramsSchemas)[K]> } = {
  // Before the daily follow-up routine (7h00), so the pilot finds the Inbox ready.
  inbox: { heure: '6h30', jours: 'Jours ouvrés' },
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
  base: { declenchement: 'Après chaque rapprochement de boîte mail' },
};

// Steps that need a connection stop the run when the instance does not have it.
export type Etape = { texte: string; besoin?: 'messagerie' | 'agenda' };
const e = (texte: string, besoin?: Etape['besoin']): Etape =>
  besoin ? { texte, besoin } : { texte };

// `cerveau`: the workstation's runner opens the second brain folder to this routine only.
export const ROUTINES: {
  cle: CleRoutine;
  nom: string;
  skill: string;
  etapes: Etape[];
  cerveau?: true;
}[] = [
  {
    cle: 'inbox',
    nom: 'Routine Inbox',
    // Private skill of the workstation: it reads mail, agenda and second brain with its own tools.
    skill: 'alimenter-inbox',
    cerveau: true,
    etapes: [
      e('Lire les sujets traités depuis le dernier passage'),
      e('Reporter le traitement et exporter les notes validées dans le second cerveau'),
      e('Chercher les nouveaux sujets (messagerie, agenda, second cerveau)', 'messagerie'),
      e("Déposer les nouveaux sujets dans l'Inbox"),
    ],
  },
  {
    cle: 'quotidienne',
    nom: 'Routine quotidienne de relance',
    skill: 'relance-quotidienne',
    etapes: [
      e('Lire les tâches de relance échues et du jour'),
      e("Vérifier l'historique de messagerie de chaque contact", 'messagerie'),
      e("Chercher des créneaux libres dans l'agenda", 'agenda'),
      e('Rédiger les brouillons, à valider', 'messagerie'),
      e("Préparer les fiches et le planning d'appels"),
      e('Produire le brief du jour'),
    ],
  },
  {
    cle: 'nettoyage',
    nom: 'Nettoyage des tâches après relance',
    skill: 'nettoyage-taches',
    etapes: [
      e('Constater dans la messagerie les relances réellement envoyées', 'messagerie'),
      e('Clôturer les tâches correspondantes'),
      e('Proposer les tâches de suivi à recréer, à valider'),
    ],
  },
  {
    cle: 'hebdo',
    nom: 'Revue hebdomadaire',
    skill: 'revue-hebdomadaire',
    etapes: [
      e('Relire le pipeline par niveau de score'),
      e('Lister les devis à relancer et les causes de perte'),
      e('Proposer des notes pour le second cerveau'),
    ],
  },
  {
    cle: 'evenement',
    nom: 'Sur événement',
    skill: 'sur-evenement',
    etapes: [
      e('Qualifier le nouveau lead'),
      e("Arrêter la séquence dès qu'un contact répond", 'messagerie'),
      e("Préparer la relance d'un devis sans réponse", 'messagerie'),
    ],
  },
  {
    cle: 'base',
    nom: 'Base vivante',
    skill: 'base-vivante',
    etapes: [
      e('Lire les imports en attente et leurs colonnes non reconnues'),
      e('Proposer la correspondance des colonnes et corriger les lignes signalées, dans le sas'),
      e('Classer les réponses reçues, à valider par le pilote'),
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
  if (cle === 'inbox' || cle === 'quotidienne') {
    const p = paramsOf(cle, params);
    const jours = p.jours === 'Jours ouvrés' ? 'Chaque jour ouvré' : p.jours;
    return `${jours} à ${p.heure}, ou à la demande`;
  }
  if (cle === 'nettoyage') return paramsOf('nettoyage', params).declenchement;
  if (cle === 'base') return paramsOf('base', params).declenchement;
  if (cle === 'hebdo') {
    const p = paramsOf('hebdo', params);
    return `${p.jour} à ${p.heure}`;
  }
  return 'Nouveau lead, réponse reçue, devis sans réponse';
}

const pluriel = (n: number, mot: string, pluriel = `${mot}s`) => `${n} ${n > 1 ? pluriel : mot}`;

// One sentence that says what the routine will do with its current settings.
export function resume(cle: CleRoutine, params: Record<string, unknown>): string {
  if (cle === 'inbox') {
    return `${rythme(cle, params).replace(', ou à la demande', '')} : reporte dans le second cerveau ce qui a été traité, puis dépose les nouveaux sujets dans l'Inbox.`;
  }
  if (cle === 'quotidienne') {
    const p = paramsOf('quotidienne', params);
    const quoi = [
      p.canaux.includes('email') ? `prépare au plus ${pluriel(p.max, 'relance')} par email` : null,
      p.canaux.includes('appel') ? "prépare le planning d'appels" : null,
    ]
      .filter(Boolean)
      .join(' et ');
    const creneaux = p.creneaux
      ? `, avec ${pluriel(p.creneaux, 'créneau', 'créneaux')} proposé${p.creneaux > 1 ? 's' : ''} à partir de J+${p.delai}`
      : ', sans créneau proposé';
    return `${rythme(cle, params).replace(', ou à la demande', '')}, ${quoi || 'ne traite aucune tâche'}${p.canaux.includes('email') ? creneaux : ''}. Tâches reprises jusqu'à ${pluriel(p.retard, 'jour')} de retard.`;
  }
  if (cle === 'nettoyage') {
    const p = paramsOf('nettoyage', params);
    return `${p.declenchement} : clôture les tâches dont la relance est partie, propose un suivi à ${pluriel(p.suivi, 'jour')}.`;
  }
  if (cle === 'hebdo') {
    const p = paramsOf('hebdo', params);
    return `Chaque ${p.jour.toLowerCase()} à ${p.heure} : revue du pipeline, devis à relancer, notes pour le second cerveau.`;
  }
  if (cle === 'base') {
    return `${rythme(cle, params)} : propose la correspondance des colonnes des imports, corrige les lignes signalées dans le sas et classe les réponses reçues. Rien n'entre dans la base ni dans un CRM sans votre validation.`;
  }
  const p = paramsOf('evenement', params);
  return `Relance un devis sans réponse après ${pluriel(p.devis, 'jour')}${p.stop ? ", et arrête la séquence dès qu'un contact répond" : ''}.`;
}
