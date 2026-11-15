import { describe, expect, it } from 'vitest';
import { estVuePresentation } from './modePresentation.js';

describe('Vues de présentation', () => {
  it('reconnaît les diaporamas et le lecteur de supports, et rien d’autre', () => {
    expect(estVuePresentation('diaporama')).toBe(true);
    expect(estVuePresentation('cours')).toBe(true);
    expect(estVuePresentation('presentation-simatis')).toBe(false);
    expect(estVuePresentation('diagnostics')).toBe(false);
    expect(estVuePresentation('brief')).toBe(false);
  });
});
