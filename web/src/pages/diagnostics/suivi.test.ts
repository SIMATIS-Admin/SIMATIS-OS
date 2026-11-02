import { describe, expect, it } from 'vitest';
import type { TestVma } from '../../api.js';
import { etapesFrise, peutRelancer, sansReponse } from './suivi.js';

const enCours = (extra: Partial<TestVma> = {}): TestVma =>
  ({
    statut: 'envoyee',
    expireLe: '2099-01-01T00:00:00.000Z',
    contactEmail: 'jeanne@exemple.test',
    envoyeeLe: '2026-10-12T08:00:00.000Z',
    relances: [],
    mailOuvertLe: null,
    lienOuvertLe: null,
    ...extra,
  }) as TestVma;

const maintenant = Date.parse('2026-11-02T08:00:00.000Z');

describe('Suivi des invitations du Test de VMA', () => {
  it('la frise ne montre que les étapes atteintes : envoi, relances, résultat', () => {
    const t = enCours({ relances: [{ le: '2026-10-19T08:00:00.000Z', origine: 'auto' }] });
    expect(etapesFrise(t)).toEqual([
      { libelle: 'Envoyé 12/10' },
      { libelle: 'Relancé 19/10 (auto)' },
    ]);
    expect(etapesFrise({ ...t, statut: 'utilisee' }).at(-1)).toEqual({ libelle: 'Test passé' });
    expect(etapesFrise(enCours({ envoyeeLe: null }))).toEqual([]);
  });

  it('la frise date l’ouverture du mail et du lien quand le site les a relevées', () => {
    const t = enCours({
      mailOuvertLe: '2026-10-13T07:00:00.000Z',
      lienOuvertLe: '2026-10-13T09:00:00.000Z',
    });
    expect(etapesFrise(t).slice(1)).toEqual([
      { libelle: 'Mail ouvert 13/10' },
      { libelle: 'Lien ouvert 13/10' },
    ]);
  });

  it('une relance à la main s’affiche sans mention', () => {
    const t = enCours({ relances: [{ le: '2026-10-20T08:00:00.000Z', origine: 'manuelle' }] });
    expect(etapesFrise(t)[1]).toEqual({ libelle: 'Relancé 20/10' });
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
