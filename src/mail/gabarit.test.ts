import { describe, expect, it } from 'vitest';
import { prenomDe, salutation } from './gabarit.js';

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
