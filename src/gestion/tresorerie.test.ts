import { describe, expect, it } from 'vitest';
import type { OccurrenceRevenu } from './revenus.js';
import type { OccurrenceVue } from './service.js';
import {
  agreger,
  calculerBfr,
  debutPeriode,
  mouvementsDepenses,
  mouvementsRecettes,
} from './tresorerie.js';

const dep = (
  o: Partial<OccurrenceVue> & { date: string; montantTtcCents: number },
): OccurrenceVue => ({
  depenseId: 'd1',
  cle: `d1|${o.date}`,
  libelle: 'Dépense fictive',
  categorie: null,
  etat: 'a_venir',
  statut: 'prevue',
  recurrente: false,
  payeur: 'societe',
  tvaCents: null,
  affectations: [],
  refacturable: false,
  justificatif: null,
  ...o,
});
const rec = (
  o: Partial<OccurrenceRevenu> & { date: string; montantHtCents: number },
): OccurrenceRevenu => ({
  revenuId: 'r1',
  cle: `r1|${o.date}`,
  libelle: 'Recette fictive',
  type: 'commission',
  mandat: null,
  certitude: 'certaine',
  dateEncaissement: null,
  etat: 'prevue',
  referenceFacture: null,
  recurrente: false,
  depenseId: null,
  tvaCents: null,
  ...o,
});
const base = { scenario: 'central' as const, soldeDate: '2026-10-31', aujourdhui: '2026-11-02' };

describe('mouvementsDepenses', () => {
  it('ne fait pas sortir du compte une dépense avancée ou créditée à l’associé (loyer)', () => {
    const r = mouvementsDepenses(
      [dep({ date: '2026-12-01', montantTtcCents: 40_000, payeur: 'associe' })],
      '2026-10-31',
      '2026-11-02',
    );
    expect(r.mouvements).toHaveLength(0);
  });

  it('compte une échéance dépassée à la date du jour, et ignore celles d’avant le solde', () => {
    const r = mouvementsDepenses(
      [
        dep({ date: '2026-11-01', montantTtcCents: 10_000 }),
        dep({ date: '2026-10-15', montantTtcCents: 5_000 }),
      ],
      '2026-10-31',
      '2026-11-02',
    );
    expect(r.mouvements.map((m) => [m.date, m.montantCents])).toEqual([['2026-11-02', 10_000]]);
    expect(r.ignorees).toBe(1);
  });

  it('ne compte une dépense payée que si elle est postérieure au solde (pas de double compte)', () => {
    const payee = (date: string) => dep({ date, montantTtcCents: 7_000, etat: 'payee' });
    expect(
      mouvementsDepenses([payee('2026-10-20')], '2026-10-31', '2026-11-02').mouvements,
    ).toEqual([]);
    expect(
      mouvementsDepenses([payee('2026-11-01')], '2026-10-31', '2026-11-02').mouvements,
    ).toHaveLength(1);
  });
});

describe('mouvementsRecettes', () => {
  const p = { ...base, delaiJours: 30, retardJours: 0 };

  it('encaisse à la date de facture plus le délai réglé, jamais en HT silencieux', () => {
    const r = mouvementsRecettes([rec({ date: '2026-11-10', montantHtCents: 100_000 })], p);
    expect(r.mouvements[0]).toMatchObject({
      date: '2026-12-10',
      montantCents: 100_000,
      estime: true,
    });
    expect(r.mouvements[0]!.note).toContain('HT');
  });

  it('ajoute la TVA renseignée et décale la date avec un retard simulé', () => {
    const o = rec({ date: '2026-11-10', montantHtCents: 100_000, tvaCents: 20_000 });
    const r = mouvementsRecettes([o], { ...p, retardJours: 30 });
    expect(r.mouvements[0]).toMatchObject({ date: '2027-01-09', montantCents: 120_000 });
    expect(r.mouvements[0]!.note).toContain('Retard simulé de 30 jours');
  });

  it('sans délai défini, suppose la date de facture et le dit', () => {
    const r = mouvementsRecettes([rec({ date: '2026-11-10', montantHtCents: 1_000 })], {
      ...base,
      delaiJours: null,
      retardJours: 0,
    });
    expect(r.mouvements[0]!.date).toBe('2026-11-10');
    expect(r.mouvements[0]!.note).toContain('Délai de paiement non défini');
  });

  it('sépare les scénarios par certitude : le sécurisé ne retient que le certain', () => {
    const occ = [
      rec({ date: '2026-12-01', montantHtCents: 1_000 }),
      rec({ date: '2026-12-02', montantHtCents: 2_000, certitude: 'probable', cle: 'r2|x' }),
      rec({ date: '2026-12-03', montantHtCents: 4_000, certitude: 'hypothese', cle: 'r3|x' }),
    ];
    const total = (s: 'securise' | 'central' | 'ambitieux') =>
      mouvementsRecettes(occ, { ...p, scenario: s }).mouvements.reduce(
        (t, m) => t + m.montantCents,
        0,
      );
    expect([total('securise'), total('central'), total('ambitieux')]).toEqual([
      1_000, 3_000, 7_000,
    ]);
  });

  it('ne reprend pas une recette encaissée avant le solde, et compte celle d’après à sa date réelle', () => {
    const e = (d: string) =>
      rec({ date: '2026-10-01', montantHtCents: 5_000, etat: 'encaissee', dateEncaissement: d });
    expect(mouvementsRecettes([e('2026-10-20')], p).mouvements).toEqual([]);
    expect(mouvementsRecettes([e('2026-11-01')], p).mouvements[0]!.date).toBe('2026-11-01');
  });
});

describe('agreger', () => {
  it('cumule les périodes à partir du solde, sans afficher de solde s’il manque', () => {
    const m = [
      { date: '2026-11-05', sens: 'entree', montantCents: 100_000 },
      { date: '2026-12-05', sens: 'sortie', montantCents: 30_000 },
    ].map((x) => ({
      ...x,
      libelle: 'x',
      nature: 'recette',
      ref: 'r',
      estime: false,
      note: null,
    })) as Parameters<typeof agreger>[0];
    const avec = agreger(m, {
      solde: 50_000,
      soldeDate: '2026-10-31',
      debut: '2026-11-02',
      fin: '2026-12-31',
      g: 'mois',
    });
    expect(avec.map((x) => x.soldeFinCents)).toEqual([150_000, 120_000]);
    const sans = agreger(m, {
      solde: null,
      soldeDate: null,
      debut: '2026-11-02',
      fin: '2026-12-31',
      g: 'mois',
    });
    expect(sans.map((x) => x.soldeFinCents)).toEqual([null, null]);
    expect(sans.map((x) => x.variationCumuleeCents)).toEqual([100_000, 70_000]);
  });

  it('découpe par semaine commençant le lundi', () => {
    expect(debutPeriode('2026-11-02', 'semaine')).toBe('2026-11-02');
    expect(debutPeriode('2026-11-08', 'semaine')).toBe('2026-11-02');
    expect(debutPeriode('2026-11-18', 'mois')).toBe('2026-11-01');
  });
});

describe('calculerBfr', () => {
  it('= créances facturées − dettes échues, seuil à zéro si négatif, limites dites', () => {
    const recettes = [
      rec({ date: '2026-10-10', montantHtCents: 100_000, etat: 'emise' }),
      rec({ date: '2026-10-11', montantHtCents: 50_000, etat: 'prevue', cle: 'r2|x' }),
    ];
    const depenses = [
      dep({ date: '2026-10-20', montantTtcCents: 30_000 }),
      dep({ date: '2026-12-20', montantTtcCents: 99_000, cle: 'd2|x' }),
    ];
    const b = calculerBfr(recettes, depenses, '2026-11-02', '2026-10-01');
    expect(b).toMatchObject({
      creancesCents: 100_000,
      dettesCents: 30_000,
      bfrCents: 70_000,
      seuilCents: 70_000,
    });
    expect(b.limites.join(' ')).toContain('TVA');
    const neg = calculerBfr([], depenses, '2026-11-02', '2026-10-01');
    expect(neg).toMatchObject({ bfrCents: -30_000, seuilCents: 0 });
  });
});
