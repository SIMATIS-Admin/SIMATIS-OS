import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tour } from './runner.js';

let dossier: string;
beforeEach(async () => {
  dossier = await mkdtemp(path.join(tmpdir(), 'cerveau-runner-'));
  await writeFile(path.join(dossier, 'index.md'), '# Accueil');
});
afterEach(() => rm(dossier, { recursive: true, force: true }));

const poste = () => Promise.resolve({ nom: 'poste-test', claude: null, skills: [] });

describe('tour : carte du second cerveau', () => {
  const lancerTour = async (cerveau: string | undefined, carteEnEchec = false) => {
    const appels: { url: string; body: unknown }[] = [];
    const fetchFaux = (url: string, init?: { body?: string }) => {
      const u = url;
      appels.push({ url: u, body: init?.body ? JSON.parse(init.body) : undefined });
      const ok = !(carteEnEchec && u.endsWith('/cerveau/carte'));
      return Promise.resolve(
        new Response(JSON.stringify(u.endsWith('/demandes') ? [] : {}), { status: ok ? 200 : 500 }),
      );
    };
    await tour({
      base: 'http://os',
      token: 't',
      claude: 'faux-claude',
      fetch: fetchFaux as unknown as typeof fetch,
      poste,
      ...(cerveau ? { cerveau } : {}),
    });
    return appels;
  };

  it('dépose la carte quand le dossier existe', async () => {
    const appels = await lancerTour(dossier);
    const carte = appels.find((a) => a.url.endsWith('/api/runner/cerveau/carte'));
    expect(carte?.body).toMatchObject({ noeuds: [{ id: 'index.md', titre: 'Accueil' }] });
  });

  it('ne dépose rien sans dossier ou avec un dossier introuvable', async () => {
    expect((await lancerTour(undefined)).some((a) => a.url.includes('/cerveau/'))).toBe(false);
    expect(
      (await lancerTour('/dossier-fictif-absent')).some((a) => a.url.includes('/cerveau/')),
    ).toBe(false);
  });

  it('un échec du dépôt n’empêche pas la suite du passage', async () => {
    const appels = await lancerTour(dossier, true);
    expect(appels.some((a) => a.url.endsWith('/api/runner/demandes'))).toBe(true);
  });
});
