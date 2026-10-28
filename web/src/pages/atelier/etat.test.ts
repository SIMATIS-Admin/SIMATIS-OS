import { describe, expect, it } from 'vitest';
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
});
