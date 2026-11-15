import type { FournisseurConso } from './schema.js';

export type Jetons = {
  entree: number;
  sortie: number;
  cacheEcriture: number;
  cacheLecture: number;
};

// Prix publics de l'API en dollars par million de jetons. Seuls les rapports comptent : le
// calibrage sur les jauges absorbe l'échelle, fournisseur par fournisseur. L'écriture de cache
// vaut 1,25 fois l'entrée chez Anthropic. Relevé le 15 novembre 2026 ; prix OpenAI de la famille
// GPT-5 (Codex), à revoir si un modèle Codex change de grille.
type Prix = { entree: number; sortie: number; cacheEcriture: number; cacheLecture: number };
const prix = (entree: number, sortie: number, cacheLecture: number, ecriture = 1.25): Prix => ({
  entree,
  sortie,
  cacheEcriture: entree * ecriture,
  cacheLecture,
});

// Du plus précis au plus général : la première sous-chaîne trouvée dans le nom du modèle gagne.
const GRILLES: Record<FournisseurConso, [string, Prix][]> = {
  claude: [
    ['fable-5-2', prix(8, 40, 0.2)],
    ['mythos-5-2', prix(8, 40, 0.2)],
    ['fable', prix(10, 50, 1)],
    ['mythos', prix(10, 50, 1)],
    ['opus-5-5', prix(4, 20, 0.2)],
    ['opus', prix(5, 25, 0.5)],
    ['sonnet-5-5', prix(2, 10, 0.1)],
    ['sonnet-5', prix(2, 10, 0.2)],
    ['sonnet', prix(3, 15, 0.3)],
    ['haiku-5-5', prix(0.1, 0.5, 0.01)],
    ['haiku', prix(1, 5, 0.1)],
  ],
  // OpenAI ne facture pas l'écriture de cache.
  chatgpt: [
    ['mini', prix(0.25, 2, 0.025, 1)],
    ['gpt-5', prix(1.25, 10, 0.125, 1)],
    ['codex', prix(1.25, 10, 0.125, 1)],
    // Modèles plus récents que ce relevé (gpt-6…) : même grille faute de mieux, le calibrage corrige.
    ['gpt-', prix(1.25, 10, 0.125, 1)],
  ],
};

// Modèle inconnu : la grille la plus chère, pour ne jamais sous-estimer une consommation.
const PAR_DEFAUT: Record<FournisseurConso, Prix> = {
  claude: prix(10, 50, 1),
  chatgpt: prix(1.25, 10, 0.125, 1),
};

export function coutEquivalent(
  fournisseur: FournisseurConso,
  modele: string,
  j: Jetons,
): { cout: number; modeleConnu: boolean } {
  const nom = modele.toLowerCase();
  const trouve = GRILLES[fournisseur].find(([cle]) => nom.includes(cle));
  const p = trouve?.[1] ?? PAR_DEFAUT[fournisseur];
  const cout =
    (j.entree * p.entree +
      j.sortie * p.sortie +
      j.cacheEcriture * p.cacheEcriture +
      j.cacheLecture * p.cacheLecture) /
    1e6;
  return { cout, modeleConnu: trouve !== undefined };
}
