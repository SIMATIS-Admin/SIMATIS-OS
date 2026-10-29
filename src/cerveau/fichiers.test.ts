import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ajouterIdee, ecrireNote, ErreurCerveau, lireNote, resoudre } from './fichiers.js';

let dossier: string;
const ecrire = async (rel: string, contenu: string) => {
  await mkdir(path.dirname(path.join(dossier, rel)), { recursive: true });
  await writeFile(path.join(dossier, rel), contenu);
};
const lire = (rel: string) => readFile(path.join(dossier, rel), 'utf8');
const JOUR = new Date('2026-10-29T10:00:00Z');

beforeEach(async () => {
  dossier = await mkdtemp(path.join(tmpdir(), 'cerveau-fichiers-'));
  await ecrire('log.md', '# Journal des changements\n\n- 1 octobre 2026 : ancienne entrée.\n');
  await ecrire('brain/clients/acme.md', '# Acme fictive\n\nTexte.');
  await ecrire('brain/inbox/index.md', '# Inbox\n\n- [A](a.md) — première.\n');
});
afterEach(() => rm(dossier, { recursive: true, force: true }));

describe('resoudre', () => {
  it('accepte une note Markdown du dossier', () => {
    expect(resoudre(dossier, 'brain/clients/acme.md')).toBe(
      path.join(dossier, 'brain/clients/acme.md'),
    );
  });

  it.each([
    '../dehors.md',
    '/etc/passwd.md',
    'brain/../../dehors.md',
    '.obsidian/app.md',
    'brain/.cache/x.md',
    'brain/clients/logo.png',
    '',
    'a\0b.md',
  ])('refuse %j', (chemin) => {
    expect(() => resoudre(dossier, chemin)).toThrow(ErreurCerveau);
  });
});

describe('lireNote et ecrireNote', () => {
  it('lit le contenu avec son empreinte', async () => {
    const note = await lireNote(dossier, 'brain/clients/acme.md');
    expect(note.contenu).toBe('# Acme fictive\n\nTexte.');
    expect(note.empreinte).toMatch(/^[0-9a-f]{64}$/);
  });

  it('une note absente est une erreur claire', async () => {
    await expect(lireNote(dossier, 'brain/clients/nope.md')).rejects.toThrow(/introuvable/);
  });

  it('écrit, change l’empreinte et note la modification en tête du journal', async () => {
    const avant = await lireNote(dossier, 'brain/clients/acme.md');
    const apres = await ecrireNote(
      dossier,
      'brain/clients/acme.md',
      '# Acme fictive\n\nNouveau texte.',
      avant.empreinte,
      JOUR,
    );
    expect(await lire('brain/clients/acme.md')).toBe('# Acme fictive\n\nNouveau texte.');
    expect(apres.empreinte).not.toBe(avant.empreinte);
    const log = await lire('log.md');
    expect(log).toMatch(
      /^# Journal des changements\n\n- 29 octobre 2026 \(depuis l'OS\) : .*\[Acme fictive\]\(brain\/clients\/acme\.md\)/,
    );
    expect(log).toContain('- 1 octobre 2026 : ancienne entrée.');
  });

  it('refuse d’écraser une note modifiée entre-temps (Obsidian, Drive)', async () => {
    const avant = await lireNote(dossier, 'brain/clients/acme.md');
    await ecrire('brain/clients/acme.md', '# Acme fictive\n\nModifiée ailleurs.');
    await expect(
      ecrireNote(dossier, 'brain/clients/acme.md', 'Mon texte', avant.empreinte, JOUR),
    ).rejects.toMatchObject({ conflit: true });
    expect(await lire('brain/clients/acme.md')).toContain('Modifiée ailleurs.');
    expect(await lire('log.md')).not.toContain("depuis l'OS");
  });

  it('ne crée pas de note par une écriture et ne dépasse pas la taille limite', async () => {
    await expect(ecrireNote(dossier, 'brain/clients/neuve.md', 'x', 'abc', JOUR)).rejects.toThrow(
      /introuvable/,
    );
    const avant = await lireNote(dossier, 'brain/clients/acme.md');
    await expect(
      ecrireNote(dossier, 'brain/clients/acme.md', 'x'.repeat(600_000), avant.empreinte, JOUR),
    ).rejects.toThrow(/trop volumineuse/);
  });

  it('modifier le journal lui-même n’y ajoute pas d’entrée', async () => {
    const avant = await lireNote(dossier, 'log.md');
    await ecrireNote(
      dossier,
      'log.md',
      `${avant.contenu}\n- ajout manuel\n`,
      avant.empreinte,
      JOUR,
    );
    expect(await lire('log.md')).not.toContain("depuis l'OS");
  });
});

describe('ajouterIdee', () => {
  it('crée une note draft dans l’inbox, la range dans l’index et la note au journal', async () => {
    const { chemin } = await ajouterIdee(
      dossier,
      { titre: 'Idée : offre à la carte', texte: 'Proposer un module seul.' },
      JOUR,
    );
    expect(chemin).toBe('brain/inbox/2026-10-29_idee-offre-a-la-carte.md');
    const note = await lire(chemin);
    expect(note).toContain('statut: draft');
    expect(note).toContain('# Idée : offre à la carte');
    expect(note).toContain('Proposer un module seul.');
    expect(await lire('brain/inbox/index.md')).toContain(
      '- [Idée : offre à la carte](2026-10-29_idee-offre-a-la-carte.md)',
    );
    expect(await lire('log.md')).toContain('2026-10-29_idee-offre-a-la-carte.md');
  });

  it('ne remplace jamais une note existante du même nom', async () => {
    const un = await ajouterIdee(dossier, { titre: 'Même titre', texte: 'a' }, JOUR);
    const deux = await ajouterIdee(dossier, { titre: 'Même titre', texte: 'b' }, JOUR);
    expect(deux.chemin).not.toBe(un.chemin);
    expect(await lire(un.chemin)).toContain('a');
    expect(await lire(deux.chemin)).toContain('b');
  });

  it('refuse une idée vide', async () => {
    await expect(ajouterIdee(dossier, { titre: '  ', texte: 'x' }, JOUR)).rejects.toThrow(/titre/);
  });
});
