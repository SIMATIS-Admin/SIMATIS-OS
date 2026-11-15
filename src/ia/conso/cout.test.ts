import { describe, expect, it } from 'vitest';
import { coutEquivalent } from './cout.js';

const rien = { entree: 0, sortie: 0, cacheEcriture: 0, cacheLecture: 0 };

describe('coutEquivalent', () => {
  it('la lecture de cache coûte une fraction de l’entrée', () => {
    const lecture = coutEquivalent('claude', 'claude-sonnet-5-5', { ...rien, cacheLecture: 1e6 });
    const entree = coutEquivalent('claude', 'claude-sonnet-5-5', { ...rien, entree: 1e6 });
    expect(lecture.cout).toBeGreaterThan(0);
    expect(lecture.cout).toBeLessThan(entree.cout);
  });

  it('opus coûte plus que sonnet à jetons égaux', () => {
    const j = { entree: 1e5, sortie: 1e4, cacheEcriture: 1e5, cacheLecture: 1e6 };
    expect(coutEquivalent('claude', 'claude-opus-5-5', j).cout).toBeGreaterThan(
      coutEquivalent('claude', 'claude-sonnet-5-5', j).cout,
    );
  });

  it('un modèle inconnu est signalé', () => {
    const r = coutEquivalent('claude', 'modele-fictif', { ...rien, entree: 1e6 });
    expect(r.modeleConnu).toBe(false);
    expect(r.cout).toBeGreaterThan(0);
  });

  it('un modèle Codex est connu et la sortie coûte plus que l’entrée', () => {
    const sortie = coutEquivalent('chatgpt', 'gpt-5-codex', { ...rien, sortie: 1e6 });
    const entree = coutEquivalent('chatgpt', 'gpt-5-codex', { ...rien, entree: 1e6 });
    expect(sortie.modeleConnu).toBe(true);
    expect(sortie.cout).toBeGreaterThan(entree.cout);
  });
});
