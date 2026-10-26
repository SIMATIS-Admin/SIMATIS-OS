import type { Instance } from '../instances/schema.js';
import type { Utilisateur } from './types.js';

// The OS has no accounts yet and Marc is its only user: he is super administrator everywhere.
// When accounts exist, this comes from the session and other users only get the role if given.
export const UTILISATEUR_PILOTE: Utilisateur = { roles: ['super_admin'] };

// Both conditions together: the role (valid in any instance) and the own instance being viewed.
export function peutTransferer(
  utilisateur: Utilisateur,
  instance: Pick<Instance, 'type'>,
): boolean {
  return utilisateur.roles.includes('super_admin') && instance.type === 'propre';
}
