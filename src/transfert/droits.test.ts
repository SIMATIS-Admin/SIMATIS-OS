import { describe, expect, it } from 'vitest';
import { peutTransferer, UTILISATEUR_PILOTE } from './droits.js';

describe('peutTransferer', () => {
  it('autorise le super-administrateur dans l’instance propre', () => {
    expect(peutTransferer(UTILISATEUR_PILOTE, { type: 'propre' })).toBe(true);
  });

  it('refuse dans un mandat et dans une démonstration', () => {
    expect(peutTransferer(UTILISATEUR_PILOTE, { type: 'mandat' })).toBe(false);
    expect(peutTransferer(UTILISATEUR_PILOTE, { type: 'prospect' })).toBe(false);
  });

  it('refuse un utilisateur sans le rôle super-administrateur', () => {
    expect(peutTransferer({ roles: [] }, { type: 'propre' })).toBe(false);
  });
});
