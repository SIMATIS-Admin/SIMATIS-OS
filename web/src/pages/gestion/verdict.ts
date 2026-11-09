import type { ProjectionTresorerie } from '../../api.js';
import { eurCents, libelleMois } from '../../gestion.js';

export type Verdict = {
  niveau: 'bon' | 'attention' | 'alerte' | 'inconnu';
  titre: string;
  texte: string;
};

const mois = (jour: string) => libelleMois(jour.slice(0, 7));

// Une phrase qui dit si la trésorerie tient, à partir des alertes que le serveur a déjà calculées.
export function verdictProjection(
  p: ProjectionTresorerie,
  decalageMois: number,
  exclus: string[] = [],
): Verdict {
  if (p.reglages.soldeCents == null || p.seuil.cents == null)
    return {
      niveau: 'inconnu',
      titre: 'Impossible de dire si la trésorerie tient.',
      texte: 'Renseignez le solde et le seuil d’alerte : sans eux, rien n’est affirmé.',
    };
  const alerte = (s: 'securise' | 'central') =>
    p.scenarios.find((x) => x.scenario === s)?.alerte ?? null;
  const securise = alerte('securise');
  const central = alerte('central');
  const comptees = p.pipe.affaires.filter((a) => a.statut === 'comptee' && !exclus.includes(a.id));
  const dependance = comptees.length
    ? `Votre trésorerie dépend de ${comptees.length} ${comptees.length > 1 ? 'affaires' : 'affaire'} encore à signer.`
    : 'Le pipe ne compte aucune affaire pour l’instant.';
  const bas = Math.min(
    ...(p.scenarios
      .find((x) => x.scenario === 'central')
      ?.periodes.flatMap((x) => (x.soldeFinCents == null ? [] : [x.soldeFinCents])) ?? []),
  );
  const retard =
    decalageMois > 0 && Number.isFinite(bas)
      ? ` Avec ${decalageMois} mois de retard, le point bas est de ${eurCents(bas)}.`
      : '';

  if (central)
    return {
      niveau: 'alerte',
      titre: `Même avec le pipe, la trésorerie passe sous le seuil en ${mois(central.debut)}.`,
      texte: `${securise ? `Sans le pipe, le seuil est franchi dès ${mois(securise.debut)}. ` : ''}${dependance}${retard}`,
    };
  if (securise)
    return {
      niveau: 'attention',
      titre: `Tout va bien si le pipe se réalise. Sans lui, le seuil saute en ${mois(securise.debut)}.`,
      texte: `${dependance}${retard}`,
    };
  return {
    niveau: 'bon',
    titre: 'La trésorerie tient sur la période, même sans le pipe.',
    texte: `Le pipe est un bonus, pas une condition.${retard}`,
  };
}
