import { describe, expect, it } from 'vitest';
import type { OccurrenceDepense, OccurrenceRevenu } from '../../api.js';
import { filtrerMouvements, fusionnerMouvements } from './mouvements.js';

const dep = (p: Partial<OccurrenceDepense> = {}): OccurrenceDepense => ({
  depenseId: 'd1',
  cle: 'd1',
  libelle: 'Abonnement fictif',
  categorie: 'Outils et abonnements',
  date: '2026-11-10',
  montantTtcCents: 12_000,
  etat: 'a_venir',
  statut: 'prevue',
  recurrente: false,
  payeur: 'societe',
  affectations: [{ cible: 'simatis' }],
  refacturable: false,
  justificatif: null,
  refacturablePrevuCents: 0,
  refactureCents: 0,
  ...p,
});
const rec = (p: Partial<OccurrenceRevenu> = {}): OccurrenceRevenu => ({
  revenuId: 'r1',
  cle: 'r1',
  libelle: 'Mission fictive',
  type: 'commission',
  mandat: null,
  certitude: 'certaine',
  date: '2026-11-10',
  dateEncaissement: null,
  montantHtCents: 50_000,
  etat: 'prevue',
  referenceFacture: null,
  recurrente: false,
  depenseId: null,
  ...p,
});
const nomAff = (a: { cible: string; mandat?: string }) => (a.cible === 'simatis' ? 'SIMATIS' : 'X');
const tous = { type: 'tout' as const, refacturables: false, recherche: '', affectation: '' };

describe('fusionnerMouvements', () => {
  it('signe les montants et indique la base', () => {
    const [d, r] = fusionnerMouvements([dep()], [rec()]);
    expect(d).toMatchObject({ sens: 'depense', montantCents: -12_000, base: 'TTC' });
    expect(r).toMatchObject({ sens: 'recette', montantCents: 50_000, base: 'HT' });
  });

  it('trie par date décroissante, puis dépenses avant recettes, puis libellé', () => {
    const m = fusionnerMouvements(
      [
        dep({ cle: 'dB', libelle: 'B' }),
        dep({ cle: 'dA', libelle: 'A' }),
        dep({ cle: 'dOld', date: '2026-11-01' }),
      ],
      [rec({ cle: 'r' }), rec({ cle: 'rNew', date: '2026-11-20' })],
    );
    expect(m.map((x) => x.cle)).toEqual(['rNew', 'dA', 'dB', 'r', 'dOld']);
  });

  it('date une recette encaissée à son encaissement', () => {
    const [m] = fusionnerMouvements(
      [],
      [rec({ etat: 'encaissee', dateEncaissement: '2026-11-25' })],
    );
    expect(m!.date).toBe('2026-11-25');
    expect(m!.etat).toBe('encaissee');
  });

  it('marque Récurrent une occurrence récurrente, Saisi sinon', () => {
    const [a, b] = fusionnerMouvements(
      [dep({ cle: 'a', recurrente: true }), dep({ cle: 'b' })],
      [],
    );
    expect(a!.origine).toBe('Récurrent');
    expect(b!.origine).toBe('Saisi');
  });

  it('transforme a_venir en prevue et garde payee', () => {
    const m = fusionnerMouvements(
      [dep({ cle: 'a' }), dep({ cle: 'p', etat: 'payee', statut: 'reelle' })],
      [],
    );
    expect(m.find((x) => x.cle === 'a')!.etat).toBe('prevue');
    expect(m.find((x) => x.cle === 'p')!.etat).toBe('payee');
  });

  it('mentionne le compte d’associé sans sortie bancaire', () => {
    const [m] = fusionnerMouvements([dep({ payeur: 'associe' })], []);
    expect(m!.detail).toContain('compte d’associé, sans sortie bancaire');
  });
});

describe('filtrerMouvements', () => {
  const m = fusionnerMouvements(
    [dep({ cle: 'd', refacturable: true }), dep({ cle: 'dp', etat: 'payee', statut: 'reelle' })],
    [rec({ cle: 'r' }), rec({ cle: 'rp', etat: 'encaissee', dateEncaissement: '2026-11-11' })],
  );

  it('depenses n’inclut aucune recette, même avec refacturables', () => {
    const f = filtrerMouvements(m, { ...tous, type: 'depenses', refacturables: true }, nomAff);
    expect(f.map((x) => x.cle)).toEqual(['d']);
  });

  it('refacturables seul écarte les recettes', () => {
    const f = filtrerMouvements(m, { ...tous, refacturables: true }, nomAff);
    expect(f.every((x) => x.sens === 'depense')).toBe(true);
  });

  it('prevus garde les dépenses à venir et les recettes prévues ou facturées', () => {
    const f = filtrerMouvements(m, { ...tous, type: 'prevus' }, nomAff);
    expect(f.map((x) => x.cle).sort()).toEqual(['d', 'r']);
  });

  it('recherche sur libellé, catégorie et affectations', () => {
    const f = filtrerMouvements(
      fusionnerMouvements([dep({ cle: 'a', libelle: 'Zzz', categorie: 'Voyage' })], [rec()]),
      { ...tous, recherche: 'voyage' },
      nomAff,
    );
    expect(f.map((x) => x.cle)).toEqual(['a']);
    const g = filtrerMouvements(m, { ...tous, recherche: 'simatis' }, nomAff);
    expect(g.every((x) => x.sens === 'depense')).toBe(true);
  });
});
