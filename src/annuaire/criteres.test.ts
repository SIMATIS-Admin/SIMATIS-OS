import { describe, expect, it, vi } from 'vitest';
import type { ClientIA } from '../enrichissement/client.js';
import { creerClientAnnuaire } from './client.js';
import { interpreter } from './interpreter.js';
import { CRITERES_VIDES, codesNafDe, criteresValides, versParametres } from './criteres.js';

describe('critères de recherche d’entreprises', () => {
  it('développe une division en codes NAF et garde les codes exacts', () => {
    const c25 = codesNafDe([{ code: '25', libelle: 'Produits métalliques' }]);
    expect(c25).toContain('25.62B');
    expect(c25.every((c) => c.startsWith('25.'))).toBe(true);
    expect(codesNafDe([{ code: '62.01Z', libelle: 'Programmation' }])).toEqual(['62.01Z']);
    expect(
      codesNafDe([
        { code: '00', libelle: 'Inconnue' },
        { code: '25.99B', libelle: 'x' },
      ]),
    ).toEqual(['25.99B']);
  });

  it('écarte ce que l’annuaire refuserait', () => {
    const c = criteresValides({
      q: '  usinage  ',
      secteurs: [
        { code: '25', libelle: 'Métal' },
        { code: 'ZZ', libelle: 'Faux' },
      ],
      departements: ['69', '01', '999', '2a'],
      effectifs: ['12', '99'],
      categories: ['PME', 'AUTRE'],
      caMin: -5,
      caMax: 5_000_000,
    });
    expect(c).toEqual({
      q: 'usinage',
      secteurs: [{ code: '25', libelle: 'Métal' }],
      departements: ['69', '01', '2A'],
      effectifs: ['12'],
      categories: ['PME'],
      caMax: 5_000_000,
    });
  });

  it('traduit les critères en paramètres de l’API, entreprises actives seulement', () => {
    const p = versParametres({
      ...CRITERES_VIDES,
      q: 'usinage',
      secteurs: [{ code: '25.62B', libelle: 'Mécanique' }],
      departements: ['69', '01'],
      effectifs: ['12', '21'],
      categories: ['PME'],
      caMin: 1_000_000,
      caMax: 5_000_000,
    });
    expect(Object.fromEntries(p)).toEqual({
      q: 'usinage',
      activite_principale: '25.62B',
      departement: '69,01',
      tranche_effectif_salarie: '12,21',
      categorie_entreprise: 'PME',
      ca_min: '1000000',
      ca_max: '5000000',
      etat_administratif: 'A',
    });
  });

  it('refuse une recherche sans aucun critère', () => {
    expect(() => versParametres(CRITERES_VIDES)).toThrow(/critère/);
  });
});

describe('recherche dans l’annuaire par critères', () => {
  it('rend une page de résultats, le total et le nombre de pages', async () => {
    const fetchFn = vi.fn<(url: string) => Promise<Response>>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            results: [{ siren: '123456789', nom_complet: 'ATELIER FICTIF' }],
            total_results: 810,
            total_pages: 33,
            page: 2,
          }),
        ),
      ),
    );
    const client = creerClientAnnuaire({ fetchFn, attendre: () => Promise.resolve() });
    const r = await client.rechercher(
      { ...CRITERES_VIDES, departements: ['69'], effectifs: ['12'] },
      2,
    );
    expect(r).toMatchObject({ total: 810, pages: 33, page: 2 });
    expect(r.resultats[0]?.siren).toBe('123456789');
    const url = new URL(fetchFn.mock.calls[0]?.[0] ?? '');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('per_page')).toBe('25');
    expect(url.searchParams.get('departement')).toBe('69');
  });
});

describe('interprétation d’une demande en langage courant', () => {
  const ia = (json: unknown): ClientIA => ({
    demander: vi.fn(() => Promise.resolve({ json, jetons: 10 })),
  });

  it('traduit la demande en critères valides et signale ce que l’annuaire ne sait pas filtrer', async () => {
    const client = ia({
      resume: 'PME de la métallurgie dans le Rhône et l’Ain',
      q: '',
      secteurs: [{ code: '25', libelle: 'Fabrication de produits métalliques' }],
      departements: ['69', '01'],
      effectifs: ['12', '21'],
      categories: ['PME'],
      caMin: null,
      caMax: null,
      nonTraites: ['sans directeur commercial'],
    });
    const r = await interpreter(
      client,
      'PME de la métallurgie du Rhône et de l’Ain, sans directeur commercial',
    );
    expect(r.criteres).toEqual({
      secteurs: [{ code: '25', libelle: 'Fabrication de produits métalliques' }],
      departements: ['69', '01'],
      effectifs: ['12', '21'],
      categories: ['PME'],
    });
    expect(r.nonTraites).toEqual(['sans directeur commercial']);
    expect(r.resume).toContain('Rhône');
  });

  it('retire les codes inventés par l’IA', async () => {
    const r = await interpreter(
      ia({
        resume: 'x',
        q: 'usinage',
        secteurs: [{ code: '25.ZZ', libelle: 'Faux' }],
        departements: ['12345'],
        effectifs: ['XX'],
        categories: [],
        caMin: null,
        caMax: null,
        nonTraites: [],
      }),
      'usinage',
    );
    expect(r.criteres).toEqual({
      q: 'usinage',
      secteurs: [],
      departements: [],
      effectifs: [],
      categories: [],
    });
  });

  it('refuse une demande vide et une réponse illisible', async () => {
    await expect(interpreter(ia({}), '   ')).rejects.toThrow(/décrivez/i);
    await expect(interpreter(ia({ resume: 3 }), 'PME')).rejects.toThrow(/illisible/i);
  });
});
