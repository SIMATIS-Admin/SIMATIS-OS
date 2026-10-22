import { describe, expect, it } from 'vitest';
import {
  memoireDe,
  proposerCorrespondance,
  trouverEntete,
  type MemoireColonnes,
} from './colonnes.js';

describe('correspondance des colonnes', () => {
  it('reconnaît les synonymes quel que soit l’ordre', () => {
    const { correspondance, inconnues } = proposerCorrespondance([
      'Tél. direct',
      'E-mail pro',
      'Raison sociale',
      'Prénom',
      'Nom',
      'Code interne',
    ]);
    expect(correspondance).toEqual({
      telephone: 0,
      email: 1,
      entreprise: 2,
      prenom: 3,
      nom: 4,
    });
    expect(inconnues).toEqual([5]);
  });

  it('distingue le téléphone fixe du portable', () => {
    const { correspondance } = proposerCorrespondance(['Telephone', 'Portable', 'Mobile 2']);
    expect(correspondance).toEqual({ telephone: 0, portable: 1 });
  });

  it('ne prend pas « nom de l’entreprise » pour un nom de personne', () => {
    const { correspondance } = proposerCorrespondance(['Nom de l’entreprise', 'Nom', 'Prénom']);
    expect(correspondance).toEqual({ entreprise: 0, nom: 1, prenom: 2 });
  });

  it('abandonne la colonne combinée quand prénom et nom sont séparés', () => {
    const { correspondance } = proposerCorrespondance(['Contact', 'Prénom', 'Nom']);
    expect(correspondance.nomComplet).toBeUndefined();
    const seule = proposerCorrespondance(['Contact', 'Société']).correspondance;
    expect(seule.nomComplet).toBe(0);
  });

  it('applique d’abord ce que l’OS a mémorisé pour la source', () => {
    const memoire: MemoireColonnes = { 'code interne': null, interlocuteur: 'nom' };
    const { correspondance, inconnues } = proposerCorrespondance(
      ['Code interne', 'Interlocuteur', 'Société'],
      memoire,
    );
    expect(correspondance).toEqual({ nom: 1, entreprise: 2 });
    expect(inconnues).toEqual([]);
  });

  it('mémorise la correspondance validée, colonnes ignorées comprises', () => {
    const entetes = ['Société', 'Code interne', 'Mail'];
    const memoire = memoireDe(entetes, { entreprise: 0, email: 2 });
    expect(memoire).toEqual({ societe: 'entreprise', 'code interne': null, mail: 'email' });
    expect(proposerCorrespondance(entetes, memoire).inconnues).toEqual([]);
  });
});

describe('ligne d’en-tête', () => {
  it('la retrouve sous des lignes de titre', () => {
    const lignes = [
      ['Salon fictif 2026'],
      ['Export du 12/10'],
      ['Société', 'Nom', 'Email'],
      ['Acme', 'Durand', 'd@acme.test'],
    ];
    expect(trouverEntete(lignes)).toBe(2);
  });
  it('retourne null quand rien ne ressemble à un en-tête', () => {
    expect(
      trouverEntete([
        ['Acme', 'Durand'],
        ['Beta', 'Petit'],
      ]),
    ).toBeNull();
  });
});
