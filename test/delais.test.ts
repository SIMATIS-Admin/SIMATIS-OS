import { expect, it } from 'vitest';
import config from '../vitest.config.js';

// Chaque fichier de test crée et migre sa base : sur une machine chargée, 5 secondes ne suffisent
// pas et des tests sans défaut expirent au hasard. Ce garde-fou empêche de revenir au délai par défaut.
it('laisse aux tests, comme aux crochets, le temps de créer leur base', () => {
  expect(config.test?.testTimeout).toBeGreaterThanOrEqual(30_000);
  expect(config.test?.hookTimeout).toBeGreaterThanOrEqual(30_000);
});
