// Pipeline stages and display helpers, from the mockup (data.js ETAPES, core.js eur).
export const ETAPES = [
  { id: 'detection', nom: 'Détection' },
  { id: 'prospection', nom: 'Prospection' },
  { id: 'qualification', nom: 'Qualification' },
  { id: 'proposition', nom: 'Proposition' },
  { id: 'negociation', nom: 'Négociation' },
];

export const etapeNom = (o: { etape: string; clos: 'gagne' | 'perdu' | null }) =>
  o.clos === 'gagne'
    ? 'Gagnée'
    : o.clos === 'perdu'
      ? 'Perdue'
      : (ETAPES.find((e) => e.id === o.etape)?.nom ?? o.etape);

export const eur = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} €`;

// `montant` is euros once for a spot deal, euros per month for a recurring one: both are shown
// side by side and never added together.
export type Facturation = {
  montant: number | null;
  modeFacturation: 'spot' | 'recurrent';
  dureeEngagementMois: number;
  taciteReconduction: boolean;
};
export const montantEur = (o: Pick<Facturation, 'montant' | 'modeFacturation'>) =>
  o.montant ? `${eur(o.montant)}${o.modeFacturation === 'recurrent' ? '/mois' : ''}` : '';
export const engagement = (o: Facturation) =>
  `${o.dureeEngagementMois} mois${o.taciteReconduction ? ', tacite reconduction' : ''}`;
export const sommes = <T extends Pick<Facturation, 'montant' | 'modeFacturation'>>(
  os: T[],
  poids: (o: T) => number = () => 1,
) => {
  const total = (recurrent: boolean) =>
    os.reduce(
      (a, o) =>
        a + ((o.modeFacturation === 'recurrent') === recurrent ? (o.montant ?? 0) * poids(o) : 0),
      0,
    );
  return { spot: total(false), mensuel: total(true) };
};
export const sommeEur = (s: { spot: number; mensuel: number }) =>
  [s.spot || !s.mensuel ? eur(s.spot) : '', s.mensuel ? `${eur(s.mensuel)}/mois` : '']
    .filter(Boolean)
    .join(' + ');
