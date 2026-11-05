import { describe, expect, it } from 'vitest';
import type { Feuille } from '../base-vivante/lecture.js';
import { ImportInvalide, lireTransactions } from './import-pennylane.js';

const ENTETE = ['Date', 'Libellé', 'Montant', 'Compte Bancaire', 'État'];
const feuille = (...lignes: string[][]): Feuille => ({
  nom: 'Transactions bancaires',
  lignes: [ENTETE, ...lignes],
});
const l = (date: string, libelle: string, montant: string, etat = 'Transaction finalisée') => [
  date,
  libelle,
  montant,
  'Compte fictif',
  etat,
];

describe('lireTransactions', () => {
  it('lit date, libellé, montant signé en centimes et compte', () => {
    const { lignes } = lireTransactions(feuille(l('2026-10-15', 'Abonnement fictif', '-23.99')));
    expect(lignes).toEqual([
      expect.objectContaining({
        date: '2026-10-15',
        libelle: 'Abonnement fictif',
        montantCents: -2399,
        compte: 'Compte fictif',
      }),
    ]);
  });

  it('reconnaît les colonnes en désordre et sans accent', () => {
    const { lignes } = lireTransactions({
      nom: 'x',
      lignes: [
        ['montant', 'LIBELLE', 'Date'],
        ['-5', 'Café fictif', '2026-11-02'],
      ],
    });
    expect(lignes[0]).toMatchObject({ montantCents: -500, libelle: 'Café fictif', compte: '' });
  });

  it.each([
    ['-23.99', -2399],
    ['-23,99', -2399],
    ['1 234,50', 123_450],
    ['1 234,50', 123_450],
    ['+12', 1200],
    ['-1260', -126_000],
  ])('lit le montant « %s »', (brut, attendu) => {
    expect(lireTransactions(feuille(l('2026-10-15', 'X', brut))).lignes[0]!.montantCents).toBe(
      attendu,
    );
  });

  it('refuse une colonne obligatoire absente en la nommant', () => {
    const f: Feuille = {
      nom: 'x',
      lignes: [
        ['Date', 'Libellé'],
        ['2026-10-15', 'X'],
      ],
    };
    expect(() => lireTransactions(f)).toThrow(ImportInvalide);
    expect(() => lireTransactions(f)).toThrow(/Montant/);
  });

  it('refuse une ligne dont la date ou le montant est illisible, avec son numéro', () => {
    expect(() => lireTransactions(feuille(l('pas une date', 'X', '-5')))).toThrow(/ligne 2/);
    expect(() => lireTransactions(feuille(l('2026-10-15', 'X', 'abc')))).toThrow(/ligne 2/);
  });

  it('ignore et compte les lignes non finalisées', () => {
    const r = lireTransactions(
      feuille(l('2026-10-15', 'A', '-5'), l('2026-10-16', 'B', '-6', 'En attente')),
    );
    expect(r.lignes).toHaveLength(1);
    expect(r.nonFinalisees).toBe(1);
  });

  it('accepte une feuille sans colonne État', () => {
    const { lignes } = lireTransactions({
      nom: 'x',
      lignes: [
        ['Date', 'Libellé', 'Montant'],
        ['2026-10-15', 'A', '-5'],
      ],
    });
    expect(lignes).toHaveLength(1);
  });

  it('donne deux clés distinctes à deux lignes identiques, et les mêmes clés au relire', () => {
    const f = feuille(
      l('2026-10-15', 'Paiement  CB fictif', '-5'),
      l('2026-10-15', 'paiement cb fictif', '-5'),
    );
    const a = lireTransactions(f).lignes.map((x) => x.cle);
    expect(new Set(a).size).toBe(2);
    expect(a[0]).toMatch(/\|1$/);
    expect(a[1]).toMatch(/\|2$/);
    expect(lireTransactions(f).lignes.map((x) => x.cle)).toEqual(a);
  });

  it('une ligne en plus ne change pas les clés des autres', () => {
    const base = lireTransactions(feuille(l('2026-10-15', 'A', '-5'))).lignes[0]!.cle;
    const plus = lireTransactions(
      feuille(l('2026-10-16', 'B', '-7'), l('2026-10-15', 'A', '-5')),
    ).lignes.find((x) => x.libelle === 'A')!.cle;
    expect(plus).toBe(base);
  });

  it('refuse plus de 5 000 lignes', () => {
    const f = feuille(...Array.from({ length: 5001 }, (_, i) => l('2026-10-15', `L${i}`, '-1')));
    expect(() => lireTransactions(f)).toThrow(/5\s?000/);
  });

  it('une feuille vide ou sans ligne de données renvoie zéro ligne', () => {
    expect(lireTransactions(feuille()).lignes).toEqual([]);
  });
});
