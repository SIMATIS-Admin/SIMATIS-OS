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
