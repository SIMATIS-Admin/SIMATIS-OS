import { describe, expect, it } from 'vitest';
import { estVuePresentation } from './modePresentation.js';

describe('Vues de présentation', () => {
  it('reconnaît les deux présentations et rien d’autre', () => {
    expect(estVuePresentation('presentation-vma')).toBe(true);
    expect(estVuePresentation('presentation-diagnostic')).toBe(true);
    expect(estVuePresentation('diagnostics')).toBe(false);
    expect(estVuePresentation('brief')).toBe(false);
  });
});
