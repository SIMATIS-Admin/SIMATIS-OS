import type { Carte } from './carte.js';
import type { Espace } from './file.js';

// Dernière carte déposée par le runner, pour chaque cerveau. En mémoire seulement : le contenu reste
// sur le poste de Marc (Drive, kDrive), le runner redépose les cartes à chaque passage.
const dernieres = new Map<Espace, Carte & { misAJour: string }>();

export const deposerCarte = (carte: Carte, espace: Espace = 'simatis', maintenant = new Date()) => {
  dernieres.set(espace, { ...carte, misAJour: maintenant.toISOString() });
};
export const lireCarte = (espace: Espace = 'simatis') => dernieres.get(espace) ?? null;
export const viderCarte = () => dernieres.clear();
