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

// La frise d'une invitation : seulement les étapes atteintes, chacune datée, dans l'ordre.
export function etapesFrise(
  t: Pick<TestVma, 'statut' | 'envoyeeLe' | 'relances' | 'mailOuvertLe' | 'lienOuvertLe'>,
): { libelle: string }[] {
  const etapes: string[] = [];
  if (t.envoyeeLe) etapes.push(`Envoyé ${jourMois(t.envoyeeLe)}`);
  for (const r of t.relances)
    etapes.push(`Relancé ${jourMois(r.le)}${r.origine === 'auto' ? ' (auto)' : ''}`);
  // L'ouverture du mail est indicative : certaines messageries chargent les images sans que le mail soit lu.
  if (t.mailOuvertLe) etapes.push(`Mail ouvert ${jourMois(t.mailOuvertLe)}`);
  if (t.lienOuvertLe) etapes.push(`Lien ouvert ${jourMois(t.lienOuvertLe)}`);
  if (t.statut === 'utilisee') etapes.push('Test passé');
  return etapes.map((libelle) => ({ libelle }));
}
