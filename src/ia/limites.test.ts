import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lireLimitesIA } from './limites.js';

describe('limites IA', () => {
  let dossier: string;
  let fichier: string;

  beforeEach(async () => {
    dossier = await mkdtemp(path.join(tmpdir(), 'simatis-limites-ia-'));
    fichier = path.join(dossier, 'limites.json');
  });

  afterEach(async () => {
    await rm(dossier, { recursive: true, force: true });
  });

  it('lit les deux fenêtres sans jamais exposer de secret', async () => {
    await writeFile(
      fichier,
      JSON.stringify({
        actualiseLe: '2026-11-12T13:18:00.000Z',
        claude: {
          plan: 'Pro',
          fenetre5h: { restant: 72, reinitialiseLe: '2026-11-12T15:00:00.000Z' },
          hebdomadaire: { restant: 28, reinitialiseLe: '2026-11-16T08:00:00.000Z' },
        },
        chatgpt: {
          plan: 'Plus',
          fenetre5h: { restant: 84, reinitialiseLe: '2026-11-12T16:25:00.000Z' },
          hebdomadaire: { restant: 63, reinitialiseLe: '2026-11-14T23:00:00.000Z' },
        },
      }),
    );

    const resultat = await lireLimitesIA(fichier);
    expect(resultat.actualiseLe).toBe('2026-11-12T13:18:00.000Z');
    expect(resultat.fournisseurs).toMatchObject([
      { id: 'claude', etat: 'ok', plan: 'Pro', fenetre5h: { restant: 72 } },
      { id: 'chatgpt', etat: 'ok', plan: 'Plus', hebdomadaire: { restant: 63 } },
    ]);
  });

  it('reste honnête quand la source locale manque ou est invalide', async () => {
    expect((await lireLimitesIA(fichier)).fournisseurs.map((f) => f.etat)).toEqual([
      'indisponible',
      'indisponible',
    ]);
    await writeFile(fichier, '{invalide');
    expect((await lireLimitesIA(fichier)).fournisseurs.map((f) => f.etat)).toEqual([
      'erreur',
      'erreur',
    ]);
  });
});
