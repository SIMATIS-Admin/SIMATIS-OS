import { describe, expect, it } from 'vitest';
import { echeanceTrimestre } from './calcul.js';
import { completer, ETAPES, etatVide } from './etat.js';

describe("état d'un atelier", () => {
  it('a six étapes', () => {
    expect(ETAPES).toHaveLength(6);
  });

  it("l'état vide est neutre : six notes, aucun fait, aucune action", () => {
    const e = etatVide();
    expect(e).toMatchObject({ v: 1, step: 0 });
    expect(e.notes).toHaveLength(6);
    expect(e.facts).toEqual([]);
    expect(e.actions).toEqual([]);
    expect(e.icps[0]!.icp).toHaveLength(7);
    expect(e.icps[0]!.persona).toHaveLength(7);
  });

  it("l'état vide ne contient aucun texte de méthode détaillé", () => {
    const texte = JSON.stringify(etatVide());
    expect(texte.length).toBeLessThan(4000);
  });

  it('complète une ancienne sauvegarde sans les champs d’abonnement', () => {
    const e = completer({ v: 1, step: 2, obj: { ca: 50000 } });
    expect(e.step).toBe(2);
    expect(e.obj.abo).toBeGreaterThan(0);
    expect(e.obj.part).toBeGreaterThanOrEqual(0);
    expect(e.obj.ca).toBe(50000);
  });

  it('ignore un contenu qui n’est pas un objet', () => {
    expect(completer(null)).toEqual(etatVide());
    expect(completer('x')).toEqual(etatVide());
  });

  describe('sauvegarde mal formée', () => {
    it('une liste d’ICP vide laisse un ICP, et l’ICP choisi reste dans la liste', () => {
      const e = completer({ v: 1, step: 4, icps: [], icp: 5 });
      expect(e.icps).toHaveLength(1);
      expect(e.icps[0]!.icp).toHaveLength(7);
      expect(e.icp).toBe(0);
    });

    it('des faits nuls ou mal typés sont remplacés ou nettoyés', () => {
      expect(completer({ v: 1, step: 0, facts: null }).facts).toEqual([]);
      const e = completer({ v: 1, step: 0, facts: [{ k: 'a', v: 12, tag: 'inconnu' }, 'x', null] });
      expect(e.facts).toEqual([{ k: 'a', v: '', tag: 'hyp', src: '' }]);
    });

    it('une date illisible est remplacée par une date valide', () => {
      const e = completer({ v: 1, step: 5, date: '28/10/2026' });
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(() => echeanceTrimestre(e.date, 0)).not.toThrow();
    });

    it('les actions, les pistes et les scénarios mal formés sont nettoyés', () => {
      const e = completer({
        v: 1,
        step: 5,
        actions: [{ q: 'x', title: 3 }, null],
        pistes: 'non',
        scenarios: [1, 2],
        scen: 9,
        motor: -1,
      });
      expect(e.actions).toEqual([{ q: 0, bloc: '', title: '', owner: '', metric: '', on: true }]);
      expect(e.pistes).toHaveLength(7);
      expect(e.scenarios).toHaveLength(3);
      expect(e.scen).toBe(1);
      expect(e.motor).toBe(0);
    });

    it('une étape hors bornes est ramenée dans les six étapes', () => {
      expect(completer({ v: 1, step: 42 }).step).toBe(5);
      expect(completer({ v: 1, step: 'x' }).step).toBe(0);
    });

    it('un état complet et sain passe sans changement', () => {
      const sain = {
        ...etatVide(),
        date: '2026-10-27',
        facts: [{ k: 'a', v: 'b', tag: 'fait' as const, src: 's', prive: true }],
        actions: [{ q: 2, bloc: 'b', title: 't', owner: 'o', metric: 'm', on: false }],
      };
      expect(completer(JSON.parse(JSON.stringify(sain)))).toEqual(sain);
    });
  });
});
