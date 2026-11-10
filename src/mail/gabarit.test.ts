import { describe, expect, it } from 'vitest';
import { ENTETE_TEST_VMA, habillerMail, prenomDe, salutation } from './gabarit.js';

describe('prenomDe', () => {
  it.each([
    ['Jeanne DUPONT', 'Jeanne'],
    ['DUPONT Jeanne', 'Jeanne'],
    ['Jeanne Dupont', 'Jeanne'],
    ['Jean-Pierre MARTIN', 'Jean-Pierre'],
    ['  Jeanne   Dupont ', 'Jeanne'],
    ['Madame Jeanne Dupont', 'Jeanne'],
    ['Jeanne', 'Jeanne'],
    ['DUPONT', 'DUPONT'],
    ['', ''],
  ])('%s -> %s', (nom, attendu) => {
    expect(prenomDe(nom)).toBe(attendu);
  });
});

describe('salutation', () => {
  it('salue par le prénom seul', () => {
    expect(salutation('Jeanne DUPONT')).toBe('Bonjour Jeanne,');
  });

  it('échappe le prénom', () => {
    expect(salutation('<b>Jeanne</b> DUPONT')).toBe('Bonjour &lt;b&gt;Jeanne&lt;/b&gt;,');
  });

  it('sans nom : Bonjour,', () => {
    expect(salutation(null)).toBe('Bonjour,');
    expect(salutation('')).toBe('Bonjour,');
  });
});

describe('habillerMail', () => {
  it('signe avec la photo de Marc et garde le logo SIMATIS', () => {
    const html = habillerMail('<tr><td>Contenu</td></tr>');
    expect(html).toContain('/assets/logo-simatis-crop.png');
    expect(html).toContain('/assets/mail/marc-tabouret-192.jpg');
    expect(html).toContain('Directeur commercial en mode partagé');
  });

  it('affiche le logo de l’outil et une ligne d’aperçu cachée, échappée', () => {
    const html = habillerMail('<tr><td>Contenu</td></tr>', {
      entete: ENTETE_TEST_VMA,
      apercu: 'Aperçu <fictif>',
    });
    expect(html).toContain('/assets/mail/logo-test-vma.png');
    expect(html).toContain('Test de VMA');
    expect(html).toContain('display:none');
    expect(html).toContain('Aperçu &lt;fictif&gt;');
  });

  it('sans signature : ni photo ni nom', () => {
    expect(habillerMail('<tr><td>x</td></tr>', { signature: false })).not.toContain(
      'marc-tabouret-192',
    );
  });
});
