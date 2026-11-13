import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { buildApp } from '../app.js';
import { seedDemoIfEmpty } from '../demo/seed.js';

// Lecture des supports de formation : dossier hors dépôt, noms validés, aucune sortie du dossier.
describe('Supports de formation : API', () => {
  let t: TestApp;
  let app: ReturnType<typeof buildApp>;
  let dossier: string;
  let avant: string | undefined;
  const base = '/api/i/simatis/cours';

  beforeAll(async () => {
    t = await setupTestApp();
    await seedDemoIfEmpty(t.owner.db);
    dossier = await mkdtemp(path.join(tmpdir(), 'cours-api-'));
    const deck = path.join(dossier, 'exemple-fictif');
    await mkdir(path.join(deck, 'img'), { recursive: true });
    await mkdir(path.join(deck, 'clients'), { recursive: true });
    await writeFile(
      path.join(deck, 'manifest.json'),
      JSON.stringify({
        titre: 'Support fictif',
        soustitre: 'Pour les tests',
        modules: ['01-debut.md'],
      }),
    );
    await writeFile(path.join(deck, '01-debut.md'), '## Bonjour\n');
    await writeFile(path.join(deck, '02-cache.md'), '## Hors manifest\n');
    await mkdir(path.join(deck, 'slides'), { recursive: true });
    await writeFile(
      path.join(deck, 'slides', 'une.html'),
      '<section id="une"><h2>Une</h2></section>',
    );
    await writeFile(path.join(deck, 'slides', 'cachee.html'), '<section id="cachee"></section>');
    await writeFile(path.join(deck, 'deck.css'), 'section { color: #0b2038; }');
    await mkdir(path.join(dossier, 'exemple-html'), { recursive: true });
    await mkdir(path.join(dossier, 'exemple-html', 'slides'), { recursive: true });
    await writeFile(
      path.join(dossier, 'exemple-html', 'manifest.json'),
      JSON.stringify({
        titre: 'Deck HTML fictif',
        format: 'html',
        css: 'deck.css',
        parties: [{ titre: 'Partie', slides: ['slides/une.html'] }],
      }),
    );
    await writeFile(path.join(dossier, 'exemple-html', 'deck.css'), 'section { color: red; }');
    await writeFile(
      path.join(dossier, 'exemple-html', 'slides', 'une.html'),
      '<section id="une"><h2>Une</h2></section>',
    );
    await writeFile(
      path.join(dossier, 'exemple-html', 'slides', 'cachee.html'),
      '<section></section>',
    );
    await writeFile(path.join(deck, 'clients', 'client-a.json'), '{"prenom":"Alex"}');
    await writeFile(
      path.join(deck, 'img', 'schema.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg"/>',
    );
    await writeFile(path.join(dossier, 'secret.md'), 'hors du deck');
    avant = process.env.SUPPORTS_DIR;
    process.env.SUPPORTS_DIR = dossier;
    app = buildApp({
      pool: t.app.pool,
      db: t.app.db,
      version: 'test',
      secretsDir: dossier,
      realWrites: false,
    });
  });

  afterAll(async () => {
    if (avant === undefined) delete process.env.SUPPORTS_DIR;
    else process.env.SUPPORTS_DIR = avant;
    await app.close();
    await rm(dossier, { recursive: true, force: true });
    await t.drop();
  });

  const lire = (relatif: string) => app.inject({ method: 'GET', url: `${base}/${relatif}` });

  it('liste les supports qui ont un manifest', async () => {
    await mkdir(path.join(dossier, 'sans-manifest'), { recursive: true });
    const r = await app.inject({ method: 'GET', url: base });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual([
      { id: 'exemple-fictif', titre: 'Support fictif', soustitre: 'Pour les tests' },
      { id: 'exemple-html', titre: 'Deck HTML fictif', soustitre: '' },
    ]);
  });

  it('sert le manifest, un module déclaré, un profil client et une image', async () => {
    const manifest = await lire('exemple-fictif/manifest.json');
    expect(manifest.statusCode).toBe(200);
    expect(manifest.json()).toMatchObject({ titre: 'Support fictif' });
    const module = await lire('exemple-fictif/01-debut.md');
    expect(module.statusCode).toBe(200);
    expect(module.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(module.headers['last-modified']).toBeTruthy();
    expect(module.body).toBe('## Bonjour\n');
    expect((await lire('exemple-fictif/clients/client-a.json')).json()).toEqual({ prenom: 'Alex' });
    const image = await lire('exemple-fictif/img/schema.svg');
    expect(image.headers['content-type']).toBe('image/svg+xml');
  });

  it('sert en texte les slides HTML et la feuille de style déclarées, pas les autres', async () => {
    const slide = await lire('exemple-html/slides/une.html');
    expect(slide.statusCode).toBe(200);
    expect(slide.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(slide.body).toContain('<h2>Une</h2>');
    expect((await lire('exemple-html/deck.css')).statusCode).toBe(200);
    expect((await lire('exemple-html/slides/cachee.html')).statusCode).toBe(404);
    expect((await lire('exemple-html/slides/..%2Fmanifest.html')).statusCode).toBe(404);
    expect((await lire('exemple-html/autre.css')).statusCode).toBe(404);
  });

  it('refuse un module absent du manifest, un nom invalide et toute traversée de chemin', async () => {
    for (const relatif of [
      'exemple-fictif/02-cache.md',
      'exemple-fictif/absent.md',
      'exemple-fictif/%2e%2e/secret.md',
      'exemple-fictif/..%2Fsecret.md',
      'exemple-fictif/img/..%2F..%2Fsecret.md',
      'exemple-fictif/clients/..%2F..%2Fsecret.json',
      'exemple-fictif/notes.txt',
      '..%2Fexemple-fictif/manifest.json',
      'Exemple/manifest.json',
    ])
      expect((await lire(relatif)).statusCode, relatif).toBe(404);
  });

  it('dit qu aucun dossier n est configuré', async () => {
    delete process.env.SUPPORTS_DIR;
    try {
      const r = await app.inject({ method: 'GET', url: base });
      expect(r.statusCode).toBe(404);
      expect(r.json()).toEqual({ error: "Aucun dossier de supports n'est configuré." });
    } finally {
      process.env.SUPPORTS_DIR = dossier;
    }
  });
});
