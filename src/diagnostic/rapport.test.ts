import { describe, expect, it } from 'vitest';
import { rapportPret } from './rapport.js';

const dims = { outils: 2.5, strategie: 5.3, polyvalence: 9.5 };

describe('Rapport : pré-requis', () => {
  it('refuse sans résultat saisi à l étape 2', () => {
    expect(rapportPret({ dims: null, revue: { statut: 'validée' } })).toEqual({
      ok: false,
      raison: "Saisissez d'abord le résultat à l'étape 2.",
    });
  });

  it('refuse sans revue validée à l étape 3', () => {
    expect(rapportPret({ dims, revue: { statut: 'brouillon' } })).toEqual({
      ok: false,
      raison: "Validez d'abord la revue à l'étape 3.",
    });
    expect(rapportPret({ dims, revue: null })).toEqual({
      ok: false,
      raison: "Validez d'abord la revue à l'étape 3.",
    });
  });

  it('accepte un résultat et une revue validée', () => {
    expect(rapportPret({ dims, revue: { statut: 'validée' } })).toEqual({ ok: true });
  });
});
