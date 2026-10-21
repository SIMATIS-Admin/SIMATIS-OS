// Rapprochement d'un projet de diagnostic (nom en texte libre) avec une entreprise de l'annuaire.
// Un rapprochement n'est proposé que s'il est sûr : un seul nom correspond, sinon on demande à la main.
// Aucune écriture ici : le script décide quoi appliquer.

export type Proposition =
  | { projetId: string; statut: 'exact'; entrepriseId: string; entrepriseNom: string }
  | {
      projetId: string;
      statut: 'ambigu';
      candidates: { entrepriseId: string; entrepriseNom: string }[];
    }
  | { projetId: string; statut: 'aucun' };

// Minuscules, sans accents, sans ponctuation, espaces réduits : « Élodie, Fictive » = « elodie fictive ».
const normaliser = (nom: string) =>
  nom
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export function proposerRapprochements(
  projets: { id: string; nom: string }[],
  entreprises: { id: string; nom: string }[],
): Proposition[] {
  const index = new Map<string, { entrepriseId: string; entrepriseNom: string }[]>();
  for (const e of entreprises) {
    const cle = normaliser(e.nom);
    const liste = index.get(cle) ?? [];
    liste.push({ entrepriseId: e.id, entrepriseNom: e.nom });
    index.set(cle, liste);
  }

  return projets.map((p): Proposition => {
    const trouvees = index.get(normaliser(p.nom)) ?? [];
    if (trouvees.length === 0) return { projetId: p.id, statut: 'aucun' };
    if (trouvees.length === 1) {
      const [e] = trouvees;
      return { projetId: p.id, statut: 'exact', ...e! };
    }
    return { projetId: p.id, statut: 'ambigu', candidates: trouvees };
  });
}
