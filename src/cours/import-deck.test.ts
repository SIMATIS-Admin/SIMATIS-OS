import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lireManifest } from '../../web/src/cours/parseur.js';
import { convertirDeck } from './import-deck.js';

// Deck fictif au format de claude.ai : deck.json, slides, feuille de style, images publiées et
// ressources enregistrées à la racine.
describe('convertirDeck', () => {
  let racine: string;
  let source: string;

  beforeAll(async () => {
    racine = await mkdtemp(path.join(tmpdir(), 'import-deck-'));
    source = path.join(racine, 'source');
    await mkdir(path.join(source, 'project', 'slides'), { recursive: true });
    await mkdir(path.join(source, 'project', 'ds', 'marque', 'img'), { recursive: true });
    await writeFile(
      path.join(source, 'project', 'deck.json'),
      JSON.stringify({
        title: 'Deck fictif',
        order: ['cover', 'Plan_A', 'fin'],
        sections: {
          s1: { description: 'Accueil et cadre de la séance (4 min).', start: 'cover' },
          s2: { description: 'Le plan : trois temps (10 min).', start: 'Plan_A' },
        },
        faces: {
          manrope: { family: 'Manrope', href: 'https://fonts.googleapis.com/css2?family=Manrope' },
          autre: { family: 'X', href: 'https://exemple.test/x.css' },
        },
      }),
    );
    await writeFile(
      path.join(source, 'project', 'deck.css'),
      'section { color: #0b2038; } .lg { background: url(project/ds/marque/img/motif.svg); }',
    );
    await writeFile(
      path.join(source, 'project', 'slides', 'cover.html'),
      '<section id="cover"><img src="/_blob/' +
        'a'.repeat(32) +
        '" alt="logo"><img src="project/ds/marque/img/logo.png" alt="x"><h1>Titre</h1><aside>Notes</aside></section>',
    );
    await writeFile(
      path.join(source, 'project', 'slides', 'Plan_A.html'),
      '<section id="Plan_A"><h2>Plan</h2><img src="/_blob/' +
        'b'.repeat(32) +
        '" alt=""></section>',
    );
    await writeFile(
      path.join(source, 'project', 'slides', 'fin.html'),
      '<section id="fin"><h2>Fin</h2></section>',
    );
    await writeFile(path.join(source, 'project', 'ds', 'marque', 'img', 'logo.png'), 'PNG1');
    await writeFile(path.join(source, 'project', 'ds', 'marque', 'img', 'motif.svg'), '<svg/>');
    await writeFile(path.join(source, 'a'.repeat(32) + '.png'), 'PNG2');
  });

  afterAll(async () => {
    await rm(racine, { recursive: true, force: true });
  });

  it('range les slides, la feuille de style et les images, et réécrit leurs chemins', async () => {
    const destination = path.join(racine, 'sortie');
    const r = await convertirDeck(source, destination);
    expect(r.slides).toBe(3);
    expect(r.images).toBe(3);
    expect(r.manquantes).toEqual(['/_blob/' + 'b'.repeat(32)]);
    expect((await readdir(path.join(destination, 'slides'))).sort()).toEqual([
      'cover.html',
      'fin.html',
      'plan-a.html',
    ]);
    const cover = await readFile(path.join(destination, 'slides', 'cover.html'), 'utf8');
    expect(cover).toContain('src="img/' + 'a'.repeat(32) + '.png"');
    expect(cover).toContain('src="img/logo.png"');
    expect(cover).toContain('<aside>Notes</aside>');
    expect(await readFile(path.join(destination, 'deck.css'), 'utf8')).toContain(
      'url(img/motif.svg)',
    );
    expect(await readFile(path.join(destination, 'img', 'logo.png'), 'utf8')).toBe('PNG1');
  });

  it('écrit un manifest que le lecteur comprend : parties, durées, polices', async () => {
    const destination = path.join(racine, 'sortie-manifest');
    await convertirDeck(source, destination);
    const m = lireManifest(
      JSON.parse(await readFile(path.join(destination, 'manifest.json'), 'utf8')),
    );
    expect(m).toMatchObject({ titre: 'Deck fictif', format: 'html', css: 'deck.css' });
    expect(m.polices).toEqual(['https://fonts.googleapis.com/css2?family=Manrope']);
    expect(m.parties).toEqual([
      { titre: 'Accueil et cadre de la séance', duree: 4, slides: ['slides/cover.html'] },
      { titre: 'Le plan', duree: 10, slides: ['slides/plan-a.html', 'slides/fin.html'] },
    ]);
  });

  it('remplace un support existant d’un bloc, sans en garder de reste', async () => {
    const destination = path.join(racine, 'sortie-remplace');
    await mkdir(destination, { recursive: true });
    await writeFile(path.join(destination, 'ancien.txt'), 'x');
    await convertirDeck(source, destination);
    expect(await readdir(destination)).not.toContain('ancien.txt');
  });

  it('refuse un deck sans slide', async () => {
    const vide = path.join(racine, 'vide');
    await mkdir(path.join(vide, 'project'), { recursive: true });
    await writeFile(path.join(vide, 'project', 'deck.json'), JSON.stringify({ order: [] }));
    await expect(convertirDeck(vide, path.join(racine, 'sortie-vide'))).rejects.toThrow(
      /Deck vide/,
    );
  });
});
