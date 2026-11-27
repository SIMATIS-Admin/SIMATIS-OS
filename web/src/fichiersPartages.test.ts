import { describe, expect, it } from 'vitest';
import {
  dateLisible,
  dossierLisible,
  famille,
  grouper,
  nomLisible,
  tailleLisible,
  typeMime,
} from './fichiersPartages.js';

const fichier = (chemin: string, modifie = '') => ({ chemin, taille: '', modifie, auteur: '' });

describe('fichiers partagés', () => {
  it('donne un nom et un dossier lisibles', () => {
    expect(nomLisible('reference/logos/logo_demo-fond-blanc.png')).toBe('Logo demo fond blanc');
    expect(dossierLisible('reference/livres-blancs/a.pdf')).toBe('Référence › Livres blancs');
    expect(dossierLisible('reference/ressources/a.pdf')).toBe('Référence › Ressources');
    expect(dossierLisible('a.pdf')).toBe('Racine');
  });

  it('met la taille et la date à la française, sans rien inventer', () => {
    expect(tailleLisible('748.8 Ko')).toBe('748,8 Ko');
    expect(dateLisible('2026-10-13 17:42')).toBe('13 oct. 2026');
    expect(dateLisible('hier')).toBe('hier');
    expect(dateLisible('')).toBe('');
  });

  it('classe par famille et par type', () => {
    expect(famille('a.PDF')).toBe('pdf');
    expect(famille('a.svg')).toBe('image');
    expect(famille('a.html')).toBe('autre');
    expect(typeMime('a.jpg')).toBe('image/jpeg');
    expect(typeMime('a.zip')).toBe('application/octet-stream');
  });

  it('groupe par dossier, ou trie du plus récent au plus ancien', () => {
    const liste = [
      fichier('b/vieux.pdf', '2026-01-01 10:00'),
      fichier('a/neuf.pdf', '2026-02-01 10:00'),
      fichier('a/ancien.pdf', '2025-01-01 10:00'),
    ];
    expect(grouper(liste, 'dossier').map((g) => [g.titre, g.fichiers.length])).toEqual([
      ['A', 2],
      ['B', 1],
    ]);
    expect(grouper(liste, 'date')[0]?.fichiers.map((f) => f.chemin)).toEqual([
      'a/neuf.pdf',
      'b/vieux.pdf',
      'a/ancien.pdf',
    ]);
  });
});
