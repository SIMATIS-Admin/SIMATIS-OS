const propre = (texte: string | null | undefined) => (texte ?? '').replace(/\s+/g, ' ').trim();

// Nomenclature des visios de Marc : « V - Entreprise x Hôte - Motif », motif facultatif.
export function titreVisio(p: { entreprise: string; hote: string; motif?: string | null }): string {
  const entreprise = propre(p.entreprise);
  if (!entreprise) throw new Error('Entreprise obligatoire pour nommer la visio');
  const motif = propre(p.motif);
  const titre = `V - ${entreprise} x ${propre(p.hote)}`;
  return motif ? `${titre} - ${motif}` : titre;
}
