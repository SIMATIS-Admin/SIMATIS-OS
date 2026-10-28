import { z } from 'zod';

// Proposition d'accompagnement faite à la restitution : une formule par abonnement et des options
// libres. Les montants sont saisis par le pilote, jamais proposés ; null = « sur devis ». La forme
// reste proche des lignes de devis pour que le devis la reprenne telle quelle.
const montant = z.number().min(0).max(10_000_000).nullable();
const texte = (max: number) => z.string().trim().max(max);

export const propositionSchema = z.object({
  formule: z.object({
    libelle: texte(200).min(1),
    mensualite: montant,
    engagementMois: z.number().int().min(1).max(60).default(12),
    tacite: z.boolean().default(true),
    prestations: z.array(texte(300).min(1)).max(20),
  }),
  options: z
    .array(
      z.object({
        id: texte(60).min(1),
        libelle: texte(200).min(1),
        description: texte(1000),
        tarif: z.object({ mode: z.enum(['forfait', 'mensuel']), montant }),
      }),
    )
    .max(10),
});

export type Proposition = z.infer<typeof propositionSchema>;

const eur = (m: number) => `${m.toLocaleString('fr-FR')} €`;

const tarifTexte = (mode: 'forfait' | 'mensuel', m: number | null) =>
  m === null ? 'sur devis' : `${eur(m)}${mode === 'mensuel' ? ' par mois' : ' (forfait)'}`;

// Lignes du prompt de la restitution : ce que le deck doit dire de la proposition, et rien d'autre.
export const consignesProposition = ({ formule, options }: Proposition): string[] => [
  `Formule d'accompagnement par abonnement : « ${formule.libelle} », ${
    formule.mensualite === null ? 'mensualité sur devis' : `${eur(formule.mensualite)} par mois`
  }, engagement de ${formule.engagementMois} mois${
    formule.tacite ? ', avec reconduction tacite' : ', sans reconduction tacite'
  }.`,
  ...(formule.prestations.length > 0
    ? [`Prestations incluses : ${formule.prestations.join(' ; ')}.`]
    : []),
  ...(options.length > 0
    ? [
        'Options, présentées à part de la formule (une diapositive), chacune avec son tarif exact :',
        ...options.map(
          (o) =>
            `- ${o.libelle}${o.description ? ` (${o.description})` : ''} : ${tarifTexte(o.tarif.mode, o.tarif.montant)}`,
        ),
      ]
    : []),
];
