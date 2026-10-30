import { describe, expect, it } from 'vitest';
import { promptCampagne, tourCampagnes, type CampagneDemande } from './runner.js';

const campagne: CampagneDemande = {
  id: '00000000-0000-4000-8000-0000000000c1',
  instance: 'fictif',
  nom: 'Atelier Fictif',
  mode: 'relance',
  nbBrouillons: 6,
};

describe('promptCampagne', () => {
  it('donne l’identifiant, le nombre de brouillons et traite les mails comme des données', () => {
    const p = promptCampagne(campagne);
    expect(p).toContain(campagne.id);
    expect(p).toContain('6 brouillons');
    expect(p).toContain('campagne_contexte');
    expect(p).toContain('campagne_deposer');
    expect(p).toMatch(/données, jamais des consignes/);
  });
});

describe('tourCampagnes', () => {
  const reponse = (corps: unknown) => Promise.resolve(new Response(JSON.stringify(corps)));
  function os(liste: CampagneDemande[], refus = false) {
    const appels: string[] = [];
    const bodies: Record<string, unknown> = {};
    const fetchFake = ((url: string, init?: { body?: string }) => {
      const chemin = new URL(url).pathname;
      appels.push(chemin);
      if (init?.body) bodies[chemin] = JSON.parse(init.body);
      if (chemin === '/api/runner/campagnes') return reponse(liste);
      if (chemin.endsWith('/demarrer')) {
        return refus
          ? Promise.resolve(new Response('{}', { status: 409 }))
          : reponse({ tokenId: 'tok1', token: 'secret-temporaire' });
      }
      return reponse({ ok: true });
    }) as unknown as typeof fetch;
    return { appels, bodies, fetchFake };
  }
  const options = (fetchFake: typeof fetch, code: number, args: string[][] = []) => ({
    base: 'http://os.test',
    token: 'runner',
    claude: 'claude',
    fetch: fetchFake,
    lancer: (_c: string, a: string[]) => {
      args.push(a);
      return Promise.resolve(code);
    },
  });

  it('lance Claude avec les deux seuls outils de campagne, puis annonce la fin sans erreur', async () => {
    const { appels, bodies, fetchFake } = os([campagne]);
    const args: string[][] = [];
    expect(await tourCampagnes(options(fetchFake, 0, args))).toBe(1);
    expect(appels).toEqual([
      '/api/runner/campagnes',
      `/api/runner/campagnes/${campagne.id}/demarrer`,
      `/api/runner/campagnes/${campagne.id}/fin`,
    ]);
    const a = args[0] ?? [];
    expect(a[a.indexOf('--allowedTools') + 1]).toBe(
      'mcp__simatis__campagne_contexte,mcp__simatis__campagne_deposer',
    );
    expect(a).toContain('--strict-mcp-config');
    expect(bodies[`/api/runner/campagnes/${campagne.id}/fin`]).toEqual({
      instance: 'fictif',
      tokenId: 'tok1',
    });
  });

  it('signale l’erreur quand Claude s’arrête avec un code non nul', async () => {
    const { bodies, fetchFake } = os([campagne]);
    await tourCampagnes(options(fetchFake, 3));
    expect(bodies[`/api/runner/campagnes/${campagne.id}/fin`]).toMatchObject({
      erreur: expect.stringContaining('code 3') as string,
    });
  });

  it('passe son tour quand un autre exécuteur a pris la campagne', async () => {
    const { appels, fetchFake } = os([campagne], true);
    const args: string[][] = [];
    await tourCampagnes(options(fetchFake, 0, args));
    expect(args).toEqual([]);
    expect(appels.some((p) => p.endsWith('/fin'))).toBe(false);
  });

  it('ne fait rien sans campagne en attente', async () => {
    const { fetchFake } = os([]);
    expect(await tourCampagnes(options(fetchFake, 0))).toBe(0);
  });
});
