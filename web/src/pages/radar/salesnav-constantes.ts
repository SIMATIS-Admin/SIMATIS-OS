// Limite LinkedIn de la note d'une invitation, la même que côté serveur.
export const LIMITE_NOTE_SALESNAV = 300;

export type OptionCible = {
  // Valeur enregistrée sur le profil et dans les modèles : « Entreprise · ICP A ».
  valeur: string;
  groupe: string;
  code: string;
  nom: string;
};

type CiblageNomme = { entreprise: string | null; code: string; nom: string };

// Une cible n'est enregistrée que sous la forme « Entreprise · ICP A », illisible seule : on la
// rapproche des ICP de l'Atelier pour afficher aussi le nom du segment. Les cibles qui n'y sont
// plus (ou qu'on a saisies à la main) restent proposées, sous leur seule valeur.
export function optionsCibles(ciblages: CiblageNomme[], autres: (string | null)[]): OptionCible[] {
  const options = ciblages.map((c) => ({
    valeur: `${c.entreprise ? `${c.entreprise} · ` : ''}${c.code}`,
    groupe: c.entreprise ?? 'Autres',
    code: c.code,
    nom: c.nom,
  }));
  const connues = new Set(options.map((o) => o.valeur));
  for (const valeur of new Set(autres)) {
    if (!valeur || connues.has(valeur)) continue;
    options.push({ valeur, groupe: 'Autres', code: valeur, nom: '' });
  }
  return options;
}

export const grouperCibles = (options: OptionCible[]): [string, OptionCible[]][] => {
  const groupes = new Map<string, OptionCible[]>();
  for (const o of options) groupes.set(o.groupe, [...(groupes.get(o.groupe) ?? []), o]);
  return [...groupes];
};
