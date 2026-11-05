import type { ConfigScenarioTresorerie } from '../../api.js';

export const NOMS_CERTITUDES = {
  certaine: 'certaines',
  probable: 'probables',
  hypothese: 'hypothèses',
} as const;
export const NOMS_PIPE: Record<ConfigScenarioTresorerie['pipe'], string> = {
  aucun: 'pipe non compté',
  pondere: 'pipe pondéré (montant × probabilité)',
  total: 'pipe au montant total (à 100 %)',
  chaud: 'pipe des affaires à 50 % et plus, au montant total',
};

// Phrase qui dit ce que retient un scénario : le facturé compte toujours, puis les prévisions choisies.
export function decrireScenario(c: ConfigScenarioTresorerie): string {
  const previsions = (['certaine', 'probable', 'hypothese'] as const)
    .filter((k) => c.certitudes.includes(k))
    .map((k) => NOMS_CERTITUDES[k]);
  const recettes = previsions.length
    ? `recettes facturées ou encaissées + prévisions ${previsions.join(', ')}`
    : 'recettes facturées ou encaissées seulement';
  return `${recettes} ; ${NOMS_PIPE[c.pipe]}`;
}
