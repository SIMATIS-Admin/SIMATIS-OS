import { describe, expect, it, vi } from 'vitest';
import { adressePrivee, creerLecteurWeb, ErreurSite } from './reseau.js';

const html = (corps: string, status = 200, entetes: Record<string, string> = {}) =>
  Promise.resolve(
    new Response(corps, {
      status,
      headers: { 'content-type': 'text/html; charset=utf-8', ...entetes },
    }),
  );
const publique = () => Promise.resolve(['93.184.216.34']);

describe('adresses privées', () => {
  it('reconnaît ce qu’un site public ne doit jamais atteindre', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.10',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '::1',
      '::',
      'fe80::1',
      'fd12:3456::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
    ])
      expect(adressePrivee(ip), ip).toBe(true);
    for (const ip of [
      '93.184.216.34',
      '8.8.8.8',
      '172.32.0.1',
      '2606:2800:220:1::1',
      '::ffff:8.8.8.8',
    ])
      expect(adressePrivee(ip), ip).toBe(false);
  });
});

describe('lecteur de pages web', () => {
  const lecteur = (
    fetchFn: (url: string) => Promise<Response>,
    resoudre: (hote: string) => Promise<string[]> = publique,
  ) => creerLecteurWeb({ fetchFn: (u) => fetchFn(u), resoudre, delaiMs: 500 });

  it('lit une page et rend son adresse finale', async () => {
    const fetchFn = vi.fn<(url: string) => Promise<Response>>((u) =>
      u.endsWith('/robots.txt')
        ? html('User-agent: *\nDisallow: /prive', 200, { 'content-type': 'text/plain' })
        : html('<p>Bonjour</p>'),
    );
    const r = await lecteur(fetchFn).lire('https://exemple.test/contact');
    expect(r).toEqual({ url: 'https://exemple.test/contact', html: '<p>Bonjour</p>' });
  });

  it('refuse un schéma, des identifiants ou un port inattendus', async () => {
    const l = lecteur(() => html('x'));
    await expect(l.lire('file:///etc/passwd')).rejects.toThrow(ErreurSite);
    await expect(l.lire('ftp://exemple.test')).rejects.toThrow(/adresse/i);
    await expect(l.lire('https://user:mdp@exemple.test')).rejects.toThrow(/adresse/i);
    await expect(l.lire('https://exemple.test:8443/')).rejects.toThrow(/adresse/i);
    await expect(l.lire('pas une adresse')).rejects.toThrow(/adresse/i);
  });

  it('refuse un site qui pointe vers le réseau privé ou la machine elle-même', async () => {
    const fetchFn = vi.fn(() => html('secret'));
    for (const adresse of ['10.0.0.5', '127.0.0.1', '169.254.169.254', '::1'])
      await expect(
        lecteur(fetchFn, () => Promise.resolve([adresse])).lire('https://interne.test/'),
      ).rejects.toThrow(/réseau privé/);
    await expect(
      lecteur(fetchFn, () => Promise.resolve(['93.184.216.34', '10.0.0.5'])).lire(
        'https://mixte.test/',
      ),
    ).rejects.toThrow(/réseau privé/);
    await expect(lecteur(fetchFn).lire('http://127.0.0.1/')).rejects.toThrow(/réseau privé/);
    await expect(lecteur(fetchFn).lire('http://[::1]/')).rejects.toThrow(/réseau privé/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('signale un nom de domaine qui ne se résout pas', async () => {
    await expect(
      lecteur(
        () => html('x'),
        () => Promise.resolve([]),
      ).lire('https://inconnu.test/'),
    ).rejects.toThrow(/introuvable/);
    await expect(
      lecteur(
        () => html('x'),
        () => Promise.reject(new Error('ENOTFOUND')),
      ).lire('https://inconnu.test/'),
    ).rejects.toThrow(/introuvable/);
  });

  it('suit les redirections en revérifiant chaque étape, et les limite', async () => {
    const redirige = (vers: string) =>
      Promise.resolve(new Response(null, { status: 302, headers: { location: vers } }));
    const ok = lecteur((u) =>
      u.endsWith('/robots.txt')
        ? html('', 404)
        : u === 'https://a.test/'
          ? redirige('https://www.a.test/accueil')
          : html('<p>fin</p>'),
    );
    expect(await ok.lire('https://a.test/')).toMatchObject({
      url: 'https://www.a.test/accueil',
      html: '<p>fin</p>',
    });

    const versInterne = lecteur(
      (u) => (u.endsWith('/robots.txt') ? html('', 404) : redirige('http://interne.test/')),
      (hote: string) => Promise.resolve([hote === 'interne.test' ? '10.0.0.5' : '93.184.216.34']),
    );
    await expect(versInterne.lire('https://a.test/')).rejects.toThrow(/réseau privé/);

    const boucle = lecteur((u) => (u.endsWith('/robots.txt') ? html('', 404) : redirige(u)));
    await expect(boucle.lire('https://a.test/')).rejects.toThrow(/redirections/);
  });

  it('refuse ce qui n’est pas une page web, trop gros ou en erreur', async () => {
    const robots = (u: string) => u.endsWith('/robots.txt');
    await expect(
      lecteur((u) =>
        robots(u) ? html('', 404) : html('%PDF', 200, { 'content-type': 'application/pdf' }),
      ).lire('https://a.test/'),
    ).rejects.toThrow(/page web/);
    await expect(
      lecteur((u) => (robots(u) ? html('', 404) : html('x'.repeat(700_000)))).lire(
        'https://a.test/',
      ),
    ).resolves.toHaveProperty('html');
    await expect(
      lecteur((u) => (robots(u) ? html('', 404) : html('', 503))).lire('https://a.test/'),
    ).rejects.toThrow(/503/);
  });

  it('tronque une page trop longue au lieu de tout charger', async () => {
    const r = await lecteur((u) =>
      u.endsWith('/robots.txt') ? html('', 404) : html('x'.repeat(2_000_000)),
    ).lire('https://a.test/');
    expect(r.html.length).toBeLessThanOrEqual(600_000);
  });

  it('respecte le robots.txt du site', async () => {
    const fetchFn = vi.fn((u: string) =>
      u.endsWith('/robots.txt')
        ? html(
            'User-agent: Autre\nDisallow: /\n\nUser-agent: *\nDisallow: /contact\nAllow: /',
            200,
            { 'content-type': 'text/plain' },
          )
        : html('<p>page</p>'),
    );
    const l = lecteur(fetchFn);
    await expect(l.lire('https://a.test/contact')).rejects.toThrow(/robots/);
    await expect(l.lire('https://a.test/contact/equipe')).rejects.toThrow(/robots/);
    await expect(l.lire('https://a.test/mentions')).resolves.toMatchObject({ html: '<p>page</p>' });
    const tout = lecteur(() =>
      html('User-agent: *\nDisallow: /', 200, { 'content-type': 'text/plain' }),
    );
    await expect(tout.lire('https://b.test/')).rejects.toThrow(/robots/);
  });

  it('s’identifie et ne dépasse pas son délai', async () => {
    const fetchFn = vi.fn(
      (u: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => {
        if (u.endsWith('/robots.txt')) return html('', 404);
        expect(init?.headers?.['user-agent']).toContain('SIMATIS');
        // Un en-tête HTTP ne peut contenir que de l'ASCII : sinon le vrai réseau le refuse.
        expect(init?.headers?.['user-agent']).toMatch(/^[\x20-\x7e]+$/);
        return new Promise<Response>((_, rejeter) =>
          init?.signal?.addEventListener('abort', () => rejeter(new Error('abandon'))),
        );
      },
    );
    const l = creerLecteurWeb({
      fetchFn,
      resoudre: publique,
      delaiMs: 30,
    });
    await expect(l.lire('https://lent.test/')).rejects.toThrow(/répond pas/);
  });
});
