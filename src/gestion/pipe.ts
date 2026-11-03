import { ajouterJours, ajouterMois } from './dates.js';
import type { Mouvement, Scenario } from './tresorerie.js';

// Les affaires ouvertes du Pipeline comme recettes prévisionnelles. Moteur pur : aucune base ici.
// `montant` est en euros (une fois pour un ponctuel, par mois pour un abonnement) ; tout sort en centimes.
export const SEUIL_AFFAIRE_CHAUDE = 50;
const DECALAGE_SECONDE_PART_JOURS = 60;

export type OppPipe = {
  id: string;
  titre: string;
  entreprise: string | null;
  etape: string;
  clos: 'gagne' | 'perdu' | null;
  montant: number | null;
  modeFacturation: 'spot' | 'recurrent';
  dureeEngagementMois: number;
  probabiliteManuelle: number | null;
  signatureEstimee: string | null;
  echeance: string | null;
};

export type AffairePipe = {
  id: string;
  titre: string;
  entreprise: string | null;
  probabilite: number | null;
  totalCents: number;
  recurrent: boolean;
  mensuelCents: number | null;
  dureeMois: number;
  // Signature estimée par Marc, sinon date de clôture du CRM.
  signature: string | null;
  statut: 'comptee' | 'sans_date' | 'sans_montant' | 'sans_probabilite';
};

export function affairesPipe(
  opps: OppPipe[],
  probaEtape: Map<string, number | null>,
): AffairePipe[] {
  return opps
    .filter((o) => !o.clos)
    .map((o) => {
      const recurrent = o.modeFacturation === 'recurrent';
      const probabilite = o.probabiliteManuelle ?? probaEtape.get(o.etape) ?? null;
      const signature = o.signatureEstimee ?? o.echeance;
      const mensuelCents = recurrent && o.montant ? o.montant * 100 : null;
      const totalCents = (o.montant ?? 0) * 100 * (recurrent ? o.dureeEngagementMois : 1);
      const statut: AffairePipe['statut'] = !o.montant
        ? 'sans_montant'
        : probabilite == null
          ? 'sans_probabilite'
          : !signature
            ? 'sans_date'
            : 'comptee';
      return {
        id: o.id,
        titre: o.titre,
        entreprise: o.entreprise,
        probabilite,
        totalCents,
        recurrent,
        mensuelCents,
        dureeMois: o.dureeEngagementMois,
        signature,
        statut,
      };
    });
}

// Sécurisé : rien. Central : montant × probabilité. Ambitieux : les affaires à 50 % et plus, à 100 %.
// Encaissement = signature (+ décalage simulé) + délai de paiement ; un ponctuel se règle en deux parts
// (la seconde 60 jours plus tard), un abonnement mois après mois.
export function mouvementsPipe(
  affaires: AffairePipe[],
  p: {
    scenario: Scenario;
    delaiJours: number | null;
    decalageMois: number;
    exclus: Set<string>;
    aujourdhui: string;
    fin: string;
  },
): Mouvement[] {
  if (p.scenario === 'securise') return [];
  const mouvements: Mouvement[] = [];
  for (const a of affaires) {
    if (a.statut !== 'comptee' || p.exclus.has(a.id) || !a.signature || a.probabilite == null)
      continue;
    if (p.scenario === 'ambitieux' && a.probabilite < SEUIL_AFFAIRE_CHAUDE) continue;
    const poids = p.scenario === 'central' ? a.probabilite / 100 : 1;
    // Une signature déjà passée sur une affaire encore ouverte vaut « au plus tôt aujourd'hui » : tout
    // l'échéancier démarre alors d'aujourd'hui, au lieu d'empiler l'arriéré à la date du jour.
    const signee = ajouterMois(a.signature, p.decalageMois);
    const depassee = signee < p.aujourdhui;
    const premiere = ajouterJours(depassee ? p.aujourdhui : signee, p.delaiJours ?? 0);
    const echeances: { date: string; cents: number }[] = [];
    if (a.recurrent && a.mensuelCents) {
      for (let k = 0; k < a.dureeMois; k++)
        echeances.push({
          date: ajouterMois(premiere, k),
          cents: Math.round(a.mensuelCents * poids),
        });
    } else {
      const total = Math.round(a.totalCents * poids);
      const moitie = Math.round(total / 2);
      echeances.push(
        { date: premiere, cents: moitie },
        { date: ajouterJours(premiere, DECALAGE_SECONDE_PART_JOURS), cents: total - moitie },
      );
    }
    for (const e of echeances) {
      if (e.cents <= 0 || e.date > p.fin) continue;
      mouvements.push({
        date: e.date,
        sens: 'entree',
        libelle: `${a.titre} (pipe)`,
        montantCents: e.cents,
        nature: 'recette',
        ref: `pipe:${a.id}`,
        estime: true,
        note: [
          p.scenario === 'central'
            ? `Pipe : ${a.probabilite} % de ${a.titre}`
            : `Pipe : ${a.titre} à 100 %`,
          p.decalageMois ? `Signature décalée de ${p.decalageMois} mois` : null,
          depassee ? 'Signature estimée dépassée : comptée à partir d’aujourd’hui' : null,
        ]
          .filter((n): n is string => !!n)
          .join(' · '),
      });
    }
  }
  return mouvements;
}
