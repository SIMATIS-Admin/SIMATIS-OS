import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { carteDepuisNotes, construireCarte } from './carte.js';

let dossier: string;
const ecrire = async (rel: string, contenu: string) => {
  await mkdir(path.dirname(path.join(dossier, rel)), { recursive: true });
  await writeFile(path.join(dossier, rel), contenu);
};

beforeEach(async () => {
  dossier = await mkdtemp(path.join(tmpdir(), 'cerveau-'));
});
afterEach(() => rm(dossier, { recursive: true, force: true }));

describe('construireCarte', () => {
  it('crée un nœud par note Markdown, avec titre, catégorie et statut', async () => {
    await ecrire('index.md', '# Accueil\n');
    await ecrire('brain/clients/acme.md', '---\nstatut: verified\n---\n# Acme fictive\nTexte');
    await ecrire('brain/mandats/sans-titre.md', 'Pas de titre');
    await ecrire('skills/retrouver/SKILL.md', '# Retrouver');
    await ecrire('.obsidian/workspace.json', '{}');
    await ecrire('brain/clients/logo.png', 'x');

    const { noeuds, autresFichiers } = await construireCarte(dossier);
    const par = Object.fromEntries(noeuds.map((n) => [n.id, n]));

    expect(Object.keys(par).sort()).toEqual([
      'brain/clients/acme.md',
      'brain/mandats/sans-titre.md',
      'index.md',
      'skills/retrouver/SKILL.md',
    ]);
    expect(par['brain/clients/acme.md']).toMatchObject({
      titre: 'Acme fictive',
      categorie: 'clients',
      statut: 'verified',
    });
    expect(par['brain/mandats/sans-titre.md']).toMatchObject({
      titre: 'sans-titre',
      categorie: 'mandats',
      statut: null,
    });
    expect(par['skills/retrouver/SKILL.md']?.categorie).toBe('skills');
    expect(par['index.md']?.categorie).toBe('racine');
    expect(autresFichiers).toBe(1);
  });

  it('relie les liens [[wiki]] (nom court, alias, ancre) et les liens Markdown relatifs', async () => {
    await ecrire('brain/clients/acme.md', '# Acme');
    await ecrire('brain/mandats/projet.md', '# Projet');
    await ecrire(
      'index.md',
      [
        '[[acme]] et [[projet|le projet]] et [[acme#Section]]',
        '[mandat](brain/mandats/projet.md#a) [web](https://exemple.fr/x.md)',
        '[[inexistante]] [[index]]',
      ].join('\n'),
    );
    await ecrire('brain/clients/lien.md', '[projet](../mandats/projet.md)');

    const { liens } = await construireCarte(dossier);
    const paires = liens.map((l) => `${l.de} -> ${l.vers}`).sort();

    expect(paires).toEqual([
      'brain/clients/lien.md -> brain/mandats/projet.md',
      'index.md -> brain/clients/acme.md',
      'index.md -> brain/mandats/projet.md',
    ]);
  });

  it('ignore les liens dans les blocs de code et ne dépasse pas la limite de notes', async () => {
    await ecrire('a.md', '```\n[[b]]\n```\n');
    await ecrire('b.md', '# B');
    await ecrire('c.md', '# C');

    const complet = await construireCarte(dossier);
    expect(complet.liens).toEqual([]);

    const limite = await construireCarte(dossier, { max: 2 });
    expect(limite.noeuds).toHaveLength(2);
    expect(limite.tronquee).toBe(true);
  });
});

describe('idées en vrac', () => {
  it('classe brain/idees-en-vrac/ comme catégorie propre et lit concerne', () => {
    const { noeuds } = carteDepuisNotes([
      {
        id: 'brain/idees-en-vrac/2026-10-29_x.md',
        texte: '---\nstatut: draft\nconcerne: os\n---\n\n# Idée fictive',
      },
      { id: 'brain/clients/a.md', texte: '# A' },
    ]);
    expect(noeuds[0]).toMatchObject({
      categorie: 'idees-en-vrac',
      statut: 'draft',
      concerne: 'os',
      titre: 'Idée fictive',
    });
    expect(noeuds[1]?.concerne).toBeNull();
  });
});
