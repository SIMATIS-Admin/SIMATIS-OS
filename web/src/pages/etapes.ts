import type { ProjetDiag } from '../api.js';

// Statut de chaque étape du diagnostic, dérivé des données du projet : une étape est OK quand son
// travail est fait (support prêt, résultat calculé, revue validée, rapport prêt, diagnostic restitué).
export type EtatProjet = Pick<
  ProjetDiag,
  | 'supportStatut'
  | 'dims'
  | 'profil'
  | 'pdfEntretienNom'
  | 'reponsesEntretien'
  | 'revue'
  | 'rapportLienStatut'
  | 'statutDiagnostic'
>;
export type EtatEtape = { ok: boolean; libelle: string };

export function etatsEtapes(p: EtatProjet): EtatEtape[] {
  const support: EtatEtape = {
    ok: p.supportStatut === 'pret' || p.supportStatut === 'final',
    libelle:
      p.supportStatut === 'final'
        ? 'Deck final archivé'
        : p.supportStatut === 'pret'
          ? 'Deck prêt'
          : p.supportStatut === 'preparation'
            ? 'Deck en préparation'
            : 'Deck à préparer',
  };

  let resultat: EtatEtape;
  if (p.dims && p.profil && p.pdfEntretienNom && p.reponsesEntretien.length > 0)
    resultat = {
      ok: true,
      libelle: `PDF lu (${p.reponsesEntretien.length} réponses), profil ${p.profil}`,
    };
  else if (p.dims && p.profil)
    resultat = { ok: true, libelle: `Notes saisies à la main, profil ${p.profil}` };
  else if (p.pdfEntretienNom)
    resultat = { ok: false, libelle: 'PDF importé, profil pas encore calculé' };
  else resultat = { ok: false, libelle: 'Importer le PDF de l’outil ou saisir les notes' };

  const revue: EtatEtape = {
    ok: p.revue?.statut === 'validée',
    libelle: p.revue?.statut === 'validée' ? 'Revue validée' : 'Revue à valider',
  };

  const rapport: EtatEtape = {
    ok: p.rapportLienStatut === 'pret',
    libelle:
      p.rapportLienStatut === 'pret'
        ? 'Rapport prêt'
        : p.rapportLienStatut === 'en_cours'
          ? 'Rapport en cours de rédaction'
          : 'Rapport à produire',
  };

  const restitution: EtatEtape = {
    ok: p.statutDiagnostic === 'Restitué',
    libelle: p.statutDiagnostic === 'Restitué' ? 'Diagnostic restitué' : 'Restitution à faire',
  };

  return [support, resultat, revue, rapport, restitution];
}

// Étape réellement en cours : la première qui n'est pas OK. Null quand toutes sont OK.
export function etapeEnCours(etats: EtatEtape[]): number | null {
  const i = etats.findIndex((e) => !e.ok);
  return i < 0 ? null : i + 1;
}
