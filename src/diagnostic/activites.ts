// Activités proposées au projet de diagnostic. Libellés génériques : aucune entreprise réelle.
export const ACTIVITES = [
  { id: 'usinage', nom: 'Usinage et chaudronnerie' },
  { id: 'services', nom: 'Conseil et services aux PME' },
  { id: 'batiment', nom: 'Artisanat et bâtiment' },
  { id: 'autre', nom: 'Autre activité' },
] as const;

export type ActiviteId = (typeof ACTIVITES)[number]['id'];

export const activiteValide = (id: string): id is ActiviteId => ACTIVITES.some((a) => a.id === id);
