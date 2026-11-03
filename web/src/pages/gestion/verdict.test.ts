import { describe, expect, it } from 'vitest';
import type { AffairePipe, ProjectionTresorerie } from '../../api.js';
import { verdictProjection } from './verdict.js';

const affaire = (statut: AffairePipe['statut'] = 'comptee'): AffairePipe => ({
  id: 'a',
  titre: 'Affaire fictive',
  entreprise: null,
  probabilite: 60,
  totalCents: 1_000_000,
  recurrent: false,
  mensuelCents: null,
  dureeMois: 12,
  signature: '2027-01-15',
  statut,
});
const periode = (debut: string, solde: number | null) => ({
  debut,
  fin: debut,
  entreesCents: 0,
  sortiesCents: 0,
  soldeFinCents: solde,
  variationCumuleeCents: 0,
  mouvements: [],
});
const projection = (
  alertes: { securise?: string; central?: string; ambitieux?: string } = {},
  p: { solde?: number | null; seuil?: number | null; affaires?: AffairePipe[] } = {},
): ProjectionTresorerie =>
  ({
    aujourdhui: '2026-11-12',
    granularite: 'mois',
    reglages: { soldeCents: p.solde === undefined ? 3_840_000 : p.solde },
    seuil: { mode: 'montant', cents: p.seuil === undefined ? 1_500_000 : p.seuil, bfr: null },
    scenarios: (['securise', 'central', 'ambitieux'] as const).map((scenario) => ({
      scenario,
      alerte: alertes[scenario] ? { debut: alertes[scenario]!, soldeFinCents: 100 } : null,
      periodes: [periode('2026-11-01', 3_000_000), periode('2026-12-01', 2_000_000)],
    })),
    pipe: { affaires: p.affaires ?? [affaire(), affaire()], decalageMois: 0 },
    avertissements: [],
  }) as unknown as ProjectionTresorerie;

describe('verdictProjection', () => {
  it('bon quand aucun scénario ne passe sous le seuil', () => {
    expect(verdictProjection(projection(), 0).niveau).toBe('bon');
  });

  it('attention quand seul le sécurisé passe sous le seuil, avec le mois en toutes lettres', () => {
    const v = verdictProjection(projection({ securise: '2027-05-01' }), 0);
    expect(v.niveau).toBe('attention');
    expect(v.titre).toContain('mai 2027');
    expect(v.texte).toContain('2 affaires');
  });

  it('alerte quand le central passe sous le seuil', () => {
    const v = verdictProjection(projection({ securise: '2027-03-01', central: '2027-05-01' }), 0);
    expect(v.niveau).toBe('alerte');
    expect(v.titre).toContain('mai 2027');
  });

  it('inconnu sans solde ou sans seuil, sans rien inventer', () => {
    expect(verdictProjection(projection({}, { solde: null }), 0).niveau).toBe('inconnu');
    expect(verdictProjection(projection({}, { seuil: null }), 0).niveau).toBe('inconnu');
  });

  it('cite le retard simulé et le point bas', () => {
    const v = verdictProjection(projection({ securise: '2027-05-01' }), 3);
    expect(v.texte).toContain('3 mois de retard');
    expect(v.texte).toMatch(/20\s?000 €/);
  });

  it('ignore les affaires exclues ou écartées dans le compte', () => {
    const v = verdictProjection(
      projection(
        { securise: '2027-05-01' },
        { affaires: [{ ...affaire(), id: 'x' }, affaire('sans_date')] },
      ),
      0,
      ['x'],
    );
    expect(v.texte).not.toContain('affaires');
    expect(v.texte).toContain('aucune affaire');
  });
});
