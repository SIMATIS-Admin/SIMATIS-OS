import { describe, expect, it } from 'vitest';
import type { TestVma } from '../../api.js';
import { etapesFrise, peutRelancer, sansReponse, testTermine } from './suivi.js';

const enCours = (extra: Partial<TestVma> = {}): TestVma =>
  ({
    statut: 'envoyee',
    expireLe: '2099-01-01T00:00:00.000Z',
    contactEmail: 'jeanne@exemple.test',
    envoyeeLe: '2026-10-12T08:00:00.000Z',
    relances: [],
    mailOuvertLe: null,
    lienOuvertLe: null,
    recueLe: null,
    resultat: null,
    ...extra,
  }) as TestVma;

const maintenant = Date.parse('2026-11-02T08:00:00.000Z');

describe('Suivi des invitations du Test de VMA', () => {
  it('réserve cinq emplacements identiques, même avant les premières ouvertures', () => {
    const etapes = etapesFrise(enCours());
    expect(etapes.map((e) => e.cle)).toEqual(['envoi', 'relance', 'mail', 'lien', 'resultat']);
    expect(etapes.map((e) => e.atteinte)).toEqual([true, false, false, false, false]);
    expect(etapes[0]?.date).toBe('12/10');
    expect(etapesFrise(enCours({ envoyeeLe: null }))).toHaveLength(5);
    expect(etapesFrise(enCours({ envoyeeLe: null }))[0]?.atteinte).toBe(false);
  });

  it('les ouvertures et le résultat gardent leur place même sans relance', () => {
    const etapes = etapesFrise(
      enCours({
        mailOuvertLe: '2026-10-13T07:00:00.000Z',
        lienOuvertLe: '2026-10-13T09:00:00.000Z',
        recueLe: '2026-10-14T09:00:00.000Z',
      }),
    );
    expect(etapes[1]?.atteinte).toBe(false);
    expect(etapes[2]).toMatchObject({ cle: 'mail', date: '13/10', atteinte: true });
    expect(etapes[3]).toMatchObject({ cle: 'lien', date: '13/10', atteinte: true });
    expect(etapes[4]).toMatchObject({ cle: 'resultat', date: '14/10', atteinte: true });
  });

  it('garde une place pour les relances et leur historique dans l’infobulle', () => {
    const frise = etapesFrise(
      enCours({
        relances: [
          { le: '2026-10-20T08:00:00.000Z', origine: 'manuelle' },
          { le: '2026-10-19T08:00:00.000Z', origine: 'auto' },
        ],
      }),
    );
    expect(frise).toHaveLength(5);
    expect(frise[1]).toMatchObject({ date: '20/10', detail: '19/10 (auto) · 20/10' });
  });

  it('un résultat reçu est terminé même si le statut historique est encore envoyée', () => {
    const recu = enCours({ recueLe: '2026-10-30T08:00:00.000Z' });
    expect(testTermine(recu)).toBe(true);
    expect(peutRelancer(recu, maintenant)).toBe(false);
    expect(sansReponse(recu, maintenant)).toBe(false);
    expect(testTermine(enCours({ resultat: { vma: 1200 } as TestVma['resultat'] }))).toBe(true);
    expect(testTermine(enCours({ statut: 'utilisee' }))).toBe(true);
    expect(testTermine(enCours())).toBe(false);
  });

  it('le bouton Relancer est réservé aux invitations ouvertes avec une adresse', () => {
    expect(peutRelancer(enCours(), maintenant)).toBe(true);
    expect(peutRelancer(enCours({ statut: 'utilisee' }), maintenant)).toBe(false);
    expect(peutRelancer(enCours({ statut: 'revoquee' }), maintenant)).toBe(false);
    expect(peutRelancer(enCours({ expireLe: '2026-10-30T00:00:00.000Z' }), maintenant)).toBe(false);
    expect(peutRelancer(enCours({ contactEmail: null }), maintenant)).toBe(false);
  });

  it('le filtre garde les invitations ouvertes envoyées il y a plus de 7 jours', () => {
    expect(sansReponse(enCours(), maintenant)).toBe(true);
    expect(sansReponse(enCours({ envoyeeLe: '2026-10-30T08:00:00.000Z' }), maintenant)).toBe(false);
    expect(sansReponse(enCours({ statut: 'utilisee' }), maintenant)).toBe(false);
    expect(sansReponse(enCours({ envoyeeLe: null }), maintenant)).toBe(false);
  });
});
