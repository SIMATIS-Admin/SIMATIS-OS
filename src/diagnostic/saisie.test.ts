import { describe, expect, it } from 'vitest';
import { creationSchema, projetSchema } from './saisie.js';

describe('Saisies du diagnostic', () => {
  it('refuse une activité inconnue et un nom vide', () => {
    expect(creationSchema.safeParse({ nom: 'Fictif', activite: 'inconnue' }).success).toBe(false);
    expect(creationSchema.safeParse({ nom: '   ', activite: 'usinage' }).success).toBe(false);
    expect(creationSchema.safeParse({ nom: 'Fictif', activite: 'usinage' }).success).toBe(true);
  });

  it('refuse un lien qui ne pointe pas vers claude.ai', () => {
    expect(
      projetSchema.safeParse({
        chats: { '1': { modele: 'sonnet', effort: 'moyen', lien: 'https://exemple.com/x' } },
      }).success,
    ).toBe(false);
    expect(
      projetSchema.safeParse({
        chats: { '1': { modele: 'sonnet', effort: 'moyen', lien: 'https://claude.ai/chat/abc' } },
      }).success,
    ).toBe(true);
  });

  it('borne les notes entre 0 et 10 et l étape entre 1 et 3', () => {
    expect(
      projetSchema.safeParse({ dims: { outils: 11, strategie: 1, polyvalence: 1 } }).success,
    ).toBe(false);
    expect(projetSchema.safeParse({ etape: 4 }).success).toBe(false);
    expect(
      projetSchema.safeParse({ etape: 3, dims: { outils: 2.5, strategie: 5.3, polyvalence: 9.5 } })
        .success,
    ).toBe(true);
  });

  it('refuse les champs inconnus', () => {
    expect(projetSchema.safeParse({ inconnu: 1 }).success).toBe(false);
  });
});
