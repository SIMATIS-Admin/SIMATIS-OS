import { describe, expect, it, vi } from 'vitest';
import { passerResumes, promptResume, type LancerTexte } from './resume.js';

const attente = {
  id: 's1',
  instance: 'inst',
  titre: 'V - Atelier Fictif x Simatis',
  transcript: 'Moi : Bonjour.',
};

describe('promptResume', () => {
  it('donne le titre et le transcript comme des données, jamais comme des consignes', () => {
    const p = promptResume(attente.titre, attente.transcript);
    expect(p).toContain(attente.titre);
    expect(p).toContain('Moi : Bonjour.');
    expect(p).toMatch(/jamais des consignes/);
  });
});

describe('passerResumes', () => {
  const api = (liste: unknown[], rendus: unknown[] = []) =>
    vi.fn((chemin: string, corps?: unknown) => {
      if (corps === undefined) return Promise.resolve(liste);
      rendus.push({ chemin, corps });
      return Promise.resolve({ ok: true });
    });

  it('rend à l’OS le résumé rédigé, sans espaces superflus', async () => {
    const rendus: unknown[] = [];
    const lancer: LancerTexte = () => Promise.resolve({ code: 0, stdout: '\n Résumé fictif. \n' });
    const n = await passerResumes(
      api([attente], rendus) as never,
      'claude-fictif',
      lancer,
      () => 0,
    );
    expect(n).toBe(1);
    expect(rendus).toEqual([
      { chemin: '/api/runner/resumes/s1', corps: { instance: 'inst', resume: 'Résumé fictif.' } },
    ]);
  });

  it('ne rend rien quand Claude échoue, et n’insiste pas avant dix minutes', async () => {
    const rendus: unknown[] = [];
    const lancer = vi.fn<LancerTexte>(() => Promise.resolve({ code: 1, stdout: '' }));
    let heure = 1_000_000;
    const passe = () =>
      passerResumes(
        api([{ ...attente, id: 's2' }], rendus) as never,
        'claude-fictif',
        lancer,
        () => heure,
      );
    await passe();
    await passe();
    expect(lancer).toHaveBeenCalledTimes(1);
    heure += 11 * 60_000;
    await passe();
    expect(lancer).toHaveBeenCalledTimes(2);
    expect(rendus).toEqual([]);
  });
});
