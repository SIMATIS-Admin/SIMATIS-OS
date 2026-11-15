import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { cumulerParHeure, lireClaude, lireCodex } from './lecture.js';

const fixture = (nom: string) => readFile(`test/fixtures/conso-ia/${nom}`, 'utf8');

describe('lireClaude', () => {
  it('un message répété est compté une fois', async () => {
    const { messages } = lireClaude(await fixture('claude-code.jsonl'));
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      sessionId: 'aaaaaaaa-0000-4000-8000-000000000001',
      modele: 'claude-opus-5-5',
      branche: 'feature/exemple',
      cwd: '/tmp/projet-fictif',
      entrypoint: 'claude-desktop',
      jetons: { entree: 10, sortie: 100, cacheEcriture: 1000, cacheLecture: 5000 },
    });
  });

  it('une ligne tronquée est sautée et comptée', async () => {
    expect(lireClaude(await fixture('claude-code.jsonl')).anomalies).toBe(1);
  });

  it('lit le titre de session', async () => {
    expect(lireClaude(await fixture('claude-code.jsonl')).titre).toBe('Session fictive');
  });
});

describe('cumulerParHeure', () => {
  it('une session à cheval sur deux heures est répartie', async () => {
    const { messages } = lireClaude(await fixture('claude-code.jsonl'));
    const cumuls = cumulerParHeure('claude:aaaaaaaa', messages);
    expect(cumuls).toEqual([
      {
        sessionId: 'claude:aaaaaaaa',
        heure: '2026-11-10T09:00:00.000Z',
        modele: 'claude-opus-5-5',
        entree: 10,
        sortie: 100,
        cacheEcriture: 1000,
        cacheLecture: 5000,
      },
      {
        sessionId: 'claude:aaaaaaaa',
        heure: '2026-11-10T10:00:00.000Z',
        modele: 'claude-opus-5-5',
        entree: 20,
        sortie: 200,
        cacheEcriture: 0,
        cacheLecture: 7000,
      },
    ]);
  });
});

describe('lireCodex', () => {
  it('Codex : convertit les cumuls en écarts et lit les jauges', async () => {
    const l = lireCodex(await fixture('codex.jsonl'));
    expect(l).toMatchObject({
      sessionId: 'cccccccc-0000-4000-8000-000000000003',
      originator: 'codex_exec',
      cwd: '/tmp/simatis-codex-fictif',
      anomalies: 0,
    });
    expect(l.debut?.toISOString()).toBe('2026-11-10T12:00:00.000Z');
    // Le second événement répète le premier : écart nul, donc ignoré.
    expect(l.cumuls.map((c) => c.jetons)).toEqual([
      { entree: 200, sortie: 50, cacheEcriture: 0, cacheLecture: 800 },
      { entree: 300, sortie: 100, cacheEcriture: 0, cacheLecture: 1700 },
    ]);
    expect(l.cumuls[0]?.modele).toBe('gpt-6.1-exemple');
    expect(l.jauges.at(-1)).toEqual({
      fournisseur: 'chatgpt',
      at: '2026-11-10T13:05:00.000Z',
      utilise5h: 23,
      utiliseHebdo: 6,
      reset5h: new Date(1794578400 * 1000).toISOString(),
      resetHebdo: new Date(1795096800 * 1000).toISOString(),
    });
  });
});
