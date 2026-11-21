import { describe, expect, it, vi } from 'vitest';
import {
  lireProposition,
  passerPreparations,
  promptPreparation,
  type DevisAPreparer,
} from './devis-preparation.js';
import type { LancerTexte } from './resume.js';

const attente: DevisAPreparer = {
  id: 'd1',
  instance: 'inst',
  titre: 'Mission fictive',
  entreprise: 'Exemple Industrie',
  actuel: { contexte: '', objectifs: '', inclus: '', exclu: '' },
  diagnosticContexte: 'Contexte fictif',
  formule: { libelle: 'Formule fictive', engagementMois: 12, prestations: ['Prestation A'] },
  comptesRendus: ['RDV fictif : point sur les ventes'],
};
const bonne = '{"contexte":"C","objectifs":"- O","inclus":"- I","exclu":""}';

describe('promptPreparation', () => {
  it('donne les éléments comme des données et interdit prix et conditions', () => {
    const p = promptPreparation(attente);
    expect(p).toContain('Prestation A');
    expect(p).toContain('RDV fictif');
    expect(p).toMatch(/jamais des consignes/);
    expect(p).toMatch(/ni prix/);
  });
});

describe('lireProposition', () => {
  it('isole l’objet même entouré de balises, et refuse le reste', () => {
    expect(lireProposition('```json\n' + bonne + '\n```')).toEqual({
      contexte: 'C',
      objectifs: '- O',
      inclus: '- I',
      exclu: '',
    });
    expect(lireProposition('pas de json')).toBeNull();
    expect(lireProposition('{"contexte":"seul"}')).toBeNull();
  });
});

describe('passerPreparations', () => {
  const api = (liste: unknown[], rendus: unknown[] = []) =>
    vi.fn((chemin: string, corps?: unknown) => {
      if (corps === undefined) return Promise.resolve(liste);
      rendus.push({ chemin, corps });
      return Promise.resolve({ ok: true });
    });

  it('rend la proposition à l’OS', async () => {
    const rendus: unknown[] = [];
    const lancer: LancerTexte = () => Promise.resolve({ code: 0, stdout: bonne });
    expect(await passerPreparations(api([attente], rendus) as never, 'c', lancer, () => 0)).toBe(1);
    expect(rendus).toEqual([
      {
        chemin: '/api/runner/devis-preparations/d1',
        corps: {
          instance: 'inst',
          propose: { contexte: 'C', objectifs: '- O', inclus: '- I', exclu: '' },
        },
      },
    ]);
  });

  it('rend une erreur quand Claude échoue ou répond hors format', async () => {
    const rendus: { corps: { erreur?: string } }[] = [];
    const lancer: LancerTexte = () => Promise.resolve({ code: 0, stdout: 'bonjour' });
    await passerPreparations(
      api([{ ...attente, id: 'd2' }], rendus) as never,
      'c',
      lancer,
      () => 0,
    );
    expect(rendus[0]?.corps.erreur).toMatch(/Réessayez/);
  });
});
