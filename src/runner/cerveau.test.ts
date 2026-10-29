import { describe, expect, it } from 'vitest';
import { consigneCerveau } from './cerveau.js';

describe('consigneCerveau', () => {
  it('donne le dossier et la règle d’accès, en ajout', () => {
    const t = consigneCerveau('/cerveau-fictif', 'ajout');
    expect(t).toContain('Second cerveau : /cerveau-fictif.');
    expect(t).toContain('Ajoute seulement');
    expect(t).not.toContain('Lecture seule');
  });

  it('donne la règle de lecture seule', () => {
    const t = consigneCerveau('/cerveau-fictif', 'lecture');
    expect(t).toContain('Lecture seule');
    expect(t).not.toContain('Ajoute seulement');
  });

  it('explique où commencer et comment chercher, dans le dossier et pas dans le dossier de travail', () => {
    const t = consigneCerveau('/cerveau-fictif', 'lecture');
    expect(t).toContain('CLAUDE.md');
    expect(t).toContain('REGLES-IA.md');
    expect(t).toContain('index.md');
    expect(t).toContain('Grep');
    expect(t).toContain('path « /cerveau-fictif »');
    expect(t).toContain('sources/');
  });
});
