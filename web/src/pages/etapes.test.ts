import { describe, expect, it } from 'vitest';
import { etapeEnCours, etatsEtapes, type EtatProjet } from './etapes.js';

const vide: EtatProjet = {
  supportStatut: 'aucun',
  dims: null,
  profil: null,
  pdfEntretienNom: null,
  reponsesEntretien: [],
  revue: null,
  rapportLienStatut: 'aucun',
  statutDiagnostic: null,
};

describe('Statut des étapes du diagnostic', () => {
  it('un projet neuf n a aucune étape OK et l étape en cours est la première', () => {
    const etats = etatsEtapes(vide);
    expect(etats.every((e) => !e.ok)).toBe(true);
    expect(etapeEnCours(etats)).toBe(1);
  });

  it('l étape 2 est OK quand le PDF est lu et le profil calculé', () => {
    const etats = etatsEtapes({
      ...vide,
      pdfEntretienNom: 'outil.pdf',
      reponsesEntretien: Array.from({ length: 21 }, (_, i) => ({
        section: 'R',
        numero: i + 1,
        reponse: 'B' as const,
      })),
      dims: { outils: 7.5, strategie: 5.4, polyvalence: 9.5 },
      profil: 'Sprinteur',
    });
    expect(etats[1]).toEqual({ ok: true, libelle: 'PDF lu (21 réponses), profil Sprinteur' });
  });

  it('l étape 2 est OK avec des notes saisies à la main, sans le dire comme un PDF', () => {
    const etats = etatsEtapes({
      ...vide,
      dims: { outils: 2.5, strategie: 5.3, polyvalence: 9.5 },
      profil: 'Joggeur',
    });
    expect(etats[1]).toEqual({ ok: true, libelle: 'Notes saisies à la main, profil Joggeur' });
  });

  it('un PDF importé sans profil calculé n est pas OK', () => {
    const etats = etatsEtapes({ ...vide, pdfEntretienNom: 'outil.pdf' });
    expect(etats[1]?.ok).toBe(false);
  });

  it('l étape en cours est la première qui n est pas OK, et aucune quand tout est OK', () => {
    const etats = etatsEtapes({
      supportStatut: 'final',
      dims: { outils: 7.5, strategie: 5.4, polyvalence: 9.5 },
      profil: 'Sprinteur',
      pdfEntretienNom: null,
      reponsesEntretien: [],
      revue: { statut: 'validée' },
      rapportLienStatut: 'pret',
      statutDiagnostic: 'Restitué',
    });
    expect(etats.every((e) => e.ok)).toBe(true);
    expect(etapeEnCours(etats)).toBeNull();
  });

  it('la revue validée rend l étape 3 OK, et c est l étape 4 qui reste en cours', () => {
    const etats = etatsEtapes({
      ...vide,
      supportStatut: 'pret',
      dims: { outils: 7.5, strategie: 5.4, polyvalence: 9.5 },
      profil: 'Sprinteur',
      revue: { statut: 'validée' },
    });
    expect(etats[2]?.ok).toBe(true);
    expect(etapeEnCours(etats)).toBe(4);
  });
});
