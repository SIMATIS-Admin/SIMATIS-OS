// Common French first names by gender, used only to deduce a missing civility. Ambiguous names
// (Camille, Dominique, Claude, Charlie, Maxime, Andréa…) are left out on purpose: no guess.
const MASCULINS =
  `adrien alain alexandre alexis alfred andre antoine arnaud arthur aurelien baptiste
benjamin benoit bernard bruno cedric charles christian christophe clement cyril damien daniel david
denis didier dimitri dylan eddy edouard emmanuel eric etienne fabien fabrice florent francois
franck frederic gabriel gael gaetan gerard gilbert gilles gregory guillaume guy henri herve hugo
hugues jacques jean jerome joel jonathan joseph julien kevin laurent leo leon lionel loic louis
lucas luc ludovic marc marcel mario martin mathieu matthieu maurice michel mickael nicolas noel
olivier pascal patrice patrick paul philippe pierre quentin raphael raymond regis remi remy
richard robert roger romain samuel sebastien serge stephane sylvain theo thibault thierry thomas
timothee tony valentin victor vincent vivien xavier yann yannick yves`
    .split(/\s+/)
    .filter(Boolean);

const FEMININS = `adeline agathe agnes alice alexandra alicia amandine amelie anais anne annie
antoinette audrey aurelie aurore beatrice berenice brigitte carine carole caroline catherine
cecile celine chantal charlotte chloe christelle christiane christine claire clemence colette
corinne cynthia delphine denise diane dorothee edith elisabeth elodie emilie emma estelle eva
evelyne fabienne florence francoise frederique gabrielle genevieve georgette ghislaine helene
henriette ines irene isabelle jacqueline jeanne jessica joelle josiane julie juliette laetitia
laure laurence lea lena liliane lise lucie lucile madeleine magali manon margaux margot marianne
marie marine marion martine mathilde maud melanie michele monique murielle mylene nadege nadine
nathalie nelly nicole noemie odette odile olivia pascale pauline peggy sabine sabrina sandra
sandrine sarah severine simone solange sophie stephanie suzanne sylvie thérèse therese valerie
vanessa veronique victoire virginie viviane yvette yvonne zoe`
  .split(/\s+/)
  .filter(Boolean);

const sansAccent = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '');

const PAR_PRENOM = new Map<string, 'M.' | 'Mme'>([
  ...MASCULINS.map((p) => [sansAccent(p), 'M.'] as const),
  ...FEMININS.map((p) => [sansAccent(p), 'Mme'] as const),
]);

// Compound first names (Jean-Pierre, Marie-Claire) follow their first part.
export function civiliteDuPrenom(prenom: string): 'M.' | 'Mme' | null {
  const premier = sansAccent(prenom.toLowerCase().trim()).split(/[\s-]+/)[0] ?? '';
  return PAR_PRENOM.get(premier) ?? null;
}
