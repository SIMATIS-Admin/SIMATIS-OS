import type { Carte } from './carte.js';

// Dernière carte déposée par le runner. En mémoire seulement : le second cerveau reste sur le poste
// de Marc, le runner la redépose à chaque passage.
let derniere: (Carte & { misAJour: string }) | null = null;

export const deposerCarte = (carte: Carte, maintenant = new Date()) => {
  derniere = { ...carte, misAJour: maintenant.toISOString() };
};
export const lireCarte = () => derniere;
export const viderCarte = () => {
  derniere = null;
};
