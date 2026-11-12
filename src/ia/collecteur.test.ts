import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { analyserUsageClaude } = require('../../scripts/collect-ai-limits.cjs') as {
  analyserUsageClaude: (
    sortie: string,
    maintenant: Date,
  ) => {
    fenetre5h: { restant: number; reinitialiseLe: string };
    hebdomadaire: { restant: number; reinitialiseLe: string };
  };
};

describe('collecteur des limites Claude', () => {
  it('transforme les pourcentages utilisés en capacité restante', () => {
    const maintenant = new Date(2026, 10, 12, 15, 0);
    const resultat = analyserUsageClaude(
      `Current session: 2% used · resets Nov 12 at 7:59pm (Europe/Paris)
Current week (all models): 71% used · resets Nov 13 at 1:59pm (Europe/Paris)`,
      maintenant,
    );

    expect(resultat).toEqual({
      fenetre5h: {
        restant: 98,
        reinitialiseLe: new Date(2026, 10, 12, 19, 59).toISOString(),
      },
      hebdomadaire: {
        restant: 29,
        reinitialiseLe: new Date(2026, 10, 13, 13, 59).toISOString(),
      },
    });
  });

  it('accepte une heure de réinitialisation sans minutes', () => {
    const maintenant = new Date(2026, 10, 12, 15, 0);
    const resultat = analyserUsageClaude(
      `Current session: 3% used · resets Nov 12 at 8pm (Europe/Paris)
Current week (all models): 71% used · resets Nov 13 at 2pm (Europe/Paris)`,
      maintenant,
    );

    expect(resultat.fenetre5h.reinitialiseLe).toBe(new Date(2026, 10, 12, 20, 0).toISOString());
    expect(resultat.hebdomadaire.reinitialiseLe).toBe(new Date(2026, 10, 13, 14, 0).toISOString());
  });
});
