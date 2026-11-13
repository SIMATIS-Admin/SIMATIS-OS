import { describe, expect, it } from 'vitest';
import type { LimitesIA } from '../ia/limites.js';
import { ErreurIA } from './client.js';
import { expliquerEchec, quotaBas, quotaCodex } from './quota.js';

const MAINTENANT = new Date('2026-11-12T09:00:00Z');
const limites = (
  restant: number,
  extra: { reinitialiseLe?: string; actualiseLe?: string | null; etat?: 'ok' | 'erreur' } = {},
): LimitesIA => ({
  actualiseLe: extra.actualiseLe === undefined ? '2026-11-12T08:45:00Z' : extra.actualiseLe,
  fournisseurs: [
    { id: 'claude', nom: 'Claude', etat: 'ok', plan: 'Pro', fenetre5h: null, hebdomadaire: null },
    {
      id: 'chatgpt',
      nom: 'ChatGPT',
      etat: extra.etat ?? 'ok',
      plan: 'plus',
      fenetre5h: { restant, reinitialiseLe: extra.reinitialiseLe ?? '2026-11-12T11:30:00Z' },
      hebdomadaire: null,
    },
  ],
});

describe('quotaCodex pour Claude', () => {
  it('lit le quota de Claude quand il est le moteur choisi, et le dit dans le bilan', () => {
    const l = limites(50);
    l.fournisseurs[0] = {
      id: 'claude',
      nom: 'Claude',
      etat: 'ok',
      plan: 'Max',
      fenetre5h: { restant: 3, reinitialiseLe: '2026-11-12T11:30:00Z' },
      hebdomadaire: null,
    };
    const q = quotaCodex(l, MAINTENANT, 'claude');
    expect(q).toMatchObject({ restant: 3, fournisseur: 'claude' });
    expect(quotaBas(q)).toBe(true);
    expect(expliquerEchec(new Error('x'), q).bilan).toContain('Quota Claude presque épuisé');
    expect(quotaCodex(l, MAINTENANT)?.restant).toBe(50);
  });
});

describe('quotaCodex', () => {
  it('lit le quota restant de la fenêtre de 5 heures de ChatGPT', () => {
    const q = quotaCodex(limites(12), MAINTENANT);
    expect(q?.restant).toBe(12);
    expect(q?.reinitialiseLe.toISOString()).toBe('2026-11-12T11:30:00.000Z');
  });
  it('ignore une mesure ancienne, une fenêtre déjà renouvelée ou un fournisseur en erreur', () => {
    expect(quotaCodex(limites(1, { actualiseLe: '2026-11-12T05:00:00Z' }), MAINTENANT)).toBeNull();
    expect(quotaCodex(limites(1, { actualiseLe: null }), MAINTENANT)).toBeNull();
    expect(
      quotaCodex(limites(1, { reinitialiseLe: '2026-11-12T08:30:00Z' }), MAINTENANT),
    ).toBeNull();
    expect(quotaCodex(limites(1, { etat: 'erreur' }), MAINTENANT)).toBeNull();
    expect(quotaCodex(null, MAINTENANT)).toBeNull();
  });
  it('juge le quota bas à 5 % restant ou moins', () => {
    expect(quotaBas(quotaCodex(limites(5), MAINTENANT))).toBe(true);
    expect(quotaBas(quotaCodex(limites(6), MAINTENANT))).toBe(false);
    expect(quotaBas(null)).toBe(false);
  });
});

describe('expliquerEchec', () => {
  it('nomme le quota et l’heure du nouvel essai (heure de Paris) quand il est bas', () => {
    const e = expliquerEchec(new Error('x'), quotaCodex(limites(1), MAINTENANT));
    expect(e.bilan).toBe('Quota ChatGPT presque épuisé (1 % restant). Nouvel essai à 12:31.');
    expect(e.erreur).toBe('Quota ChatGPT presque épuisé.');
    expect(e.quotaBas).toBe(true);
  });
  it('distingue un Codex muet d’un Codex qui échoue, sans prétendre connaître la cause', () => {
    const muet = expliquerEchec(
      new ErreurIA('Le programme Codex local n’a pas répondu.', true),
      null,
    );
    expect(muet.bilan).toContain('n’a pas répondu');
    expect(muet.quotaBas).toBe(false);
    const echec = expliquerEchec(
      new ErreurIA('La recherche Codex a échoué sur le Mac.', true),
      null,
    );
    expect(echec.bilan).toContain('sans en donner la cause');
    expect(echec.bilan).toContain('quota');
    const autre = expliquerEchec(new Error('boom'), null);
    expect(autre.bilan).toBe('Recherche interrompue par une erreur interne.');
    expect(autre.erreur).not.toContain('boom');
  });
});
