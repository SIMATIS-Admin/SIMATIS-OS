import { describe, expect, it } from 'vitest';
import { etatVide, type EtatAtelier } from './etat.js';
import { exportJson, exportMarkdown } from './exports.js';

const etat = (): EtatAtelier => ({
  ...etatVide(),
  date: '2026-10-27',
  notes: ['note privée fictive', '', '', '', '', ''],
  facts: [
    { k: 'Public', v: 'Information visible', tag: 'fait', src: 'test' },
    { k: 'Secret', v: 'Information réservée', tag: 'decl', src: 'test', prive: true },
  ],
  obj: { ...etatVide().obj, ca: 120000, part: 40, panier: 3000, abo: 300, mois: 6, taux: 10 },
  actions: [
    { q: 0, bloc: 'Cadrage', title: 'Action retenue', owner: 'Moi', metric: 'Fait', on: true },
    { q: 1, bloc: 'Cadrage', title: 'Action écartée', owner: 'Moi', metric: 'Fait', on: false },
  ],
});
const ctx = { entreprise: 'Entreprise Fictive' };

describe('export JSON', () => {
  it('reprend les objectifs avec l’abonnement et les actions retenues seulement', () => {
    const j = exportJson(etat(), true, ctx) as {
      schema: string;
      objectifs: Record<string, unknown>;
      taches: { titre: string; echeance: string; priorite: string }[];
    };
    expect(j.schema).toBe('simatis-os/plan-action-brouillon');
    expect(j.objectifs).toMatchObject({
      part_abonnement_pct: 40,
      ventes: 24,
      abonnes: 27,
      revenu_recurrent_mensuel_fin: 8100,
    });
    expect(j.taches).toEqual([
      expect.objectContaining({ titre: 'Action retenue', echeance: '2027-01-31', priorite: 'P1' }),
    ]);
  });

  it('écran partagé actif : ni commission ni notes privées', () => {
    const texte = JSON.stringify(exportJson(etat(), true, ctx));
    expect(texte).not.toContain('commission');
    expect(texte).not.toContain('note privée fictive');
  });

  it('écran partagé inactif : commission et notes présentes', () => {
    const j = exportJson(etat(), false, ctx) as {
      objectifs: Record<string, number>;
      notes_marc: string[];
    };
    expect(j.objectifs.commission_marc).toBe(12000);
    expect(j.objectifs.commission_recurrente_annuelle_fin).toBe(9720);
    expect(j.notes_marc).toEqual(['note privée fictive']);
  });
});

describe('export Markdown', () => {
  it('écran partagé actif : sans fait privé, commission ni notes', () => {
    const md = exportMarkdown(etat(), true, ctx);
    expect(md).toContain('Information visible');
    expect(md).not.toContain('Information réservée');
    expect(md).not.toMatch(/Commission/);
    expect(md).not.toContain('note privée fictive');
  });

  it('écran partagé inactif : fait privé, commission et notes présents', () => {
    const md = exportMarkdown(etat(), false, ctx);
    expect(md).toContain('Information réservée');
    expect(md).toMatch(/Commission/);
    expect(md).toContain('note privée fictive');
  });

  it("nomme l'entreprise passée en contexte et garde le statut brouillon", () => {
    const md = exportMarkdown(etat(), true, ctx);
    expect(md).toContain('Entreprise Fictive');
    expect(md).toContain('status: draft');
  });
});
