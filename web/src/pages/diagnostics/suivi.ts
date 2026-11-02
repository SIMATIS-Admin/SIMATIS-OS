import type { TestVma } from '../../api.js';

const JOUR_MS = 24 * 3600 * 1000;
const jourMois = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });

// Invitation encore ouverte : ni utilisée, ni révoquée, ni expirée.
const ouverte = (t: Pick<TestVma, 'statut' | 'expireLe'>, maintenant: number) =>
  t.statut === 'envoyee' && Date.parse(t.expireLe) > maintenant;

// Le bouton Relancer : une invitation ouverte, avec une adresse où écrire.
export const peutRelancer = (
  t: Pick<TestVma, 'statut' | 'expireLe' | 'contactEmail'>,
  maintenant = Date.now(),
) => ouverte(t, maintenant) && Boolean(t.contactEmail);

// Filtre « Sans réponse » : ouverte, et envoyée il y a plus de 7 jours.
export const sansReponse = (
  t: Pick<TestVma, 'statut' | 'expireLe' | 'envoyeeLe'>,
  maintenant = Date.now(),
) =>
  ouverte(t, maintenant) &&
  t.envoyeeLe !== null &&
  maintenant - Date.parse(t.envoyeeLe) > 7 * JOUR_MS;

// La frise d'une invitation : envoi, relances, résultat ; une étape non atteinte reste grisée.
export function etapesFrise(
  t: Pick<TestVma, 'statut' | 'envoyeeLe' | 'relances'>,
): { libelle: string; fait: boolean }[] {
  return [
    t.envoyeeLe
      ? { libelle: `Envoyé ${jourMois(t.envoyeeLe)}`, fait: true }
      : { libelle: 'Envoyé', fait: false },
    ...t.relances.map((r) => ({
      libelle: `Relancé ${jourMois(r.le)}${r.origine === 'auto' ? ' (auto)' : ''}`,
      fait: true,
    })),
    { libelle: 'Test passé', fait: t.statut === 'utilisee' },
  ];
}
