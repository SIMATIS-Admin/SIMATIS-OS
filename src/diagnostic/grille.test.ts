import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chargerGrille, cleQuestion, GrilleInvalide } from './grille.js';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'grille-fictive.json');

describe('Grille de scoring : chargement', () => {
  let dossier: string;

  beforeAll(async () => {
    dossier = await mkdtemp(path.join(tmpdir(), 'grille-'));
  });

  afterAll(async () => {
    await rm(dossier, { recursive: true, force: true });
  });

  it('charge la grille fictive et garde deux questions de même numéro dans deux rubriques', () => {
    const grille = chargerGrille(FIXTURE);
    expect(grille.seuil).toBe(6);
    expect(grille.questions).toHaveLength(3);
    expect(grille.questions.filter((q) => q.numero === 6)).toHaveLength(2);
  });

  it('refuse un fichier absent', () => {
    expect(() => chargerGrille(path.join(dossier, 'absente.json'))).toThrow(GrilleInvalide);
  });

  it('refuse deux questions de même rubrique et même numéro', async () => {
    const chemin = path.join(dossier, 'doublon.json');
    await writeFile(
      chemin,
      JSON.stringify({
        seuil: 6,
        questions: [
          { section: 'Rubrique A', numero: 1, libelle: 'X', dimension: 'outils', poids: 1 },
          { section: 'Rubrique A', numero: 1, libelle: 'Y', dimension: 'outils', poids: 1 },
        ],
      }),
    );
    expect(() => chargerGrille(chemin)).toThrow(GrilleInvalide);
  });

  it('refuse une dimension inconnue', async () => {
    const chemin = path.join(dossier, 'dimension.json');
    await writeFile(
      chemin,
      JSON.stringify({
        seuil: 6,
        questions: [
          { section: 'Rubrique A', numero: 1, libelle: 'X', dimension: 'autre', poids: 1 },
        ],
      }),
    );
    expect(() => chargerGrille(chemin)).toThrow(GrilleInvalide);
  });

  it('identifie une question par sa rubrique et son numéro', () => {
    expect(cleQuestion({ section: 'Rubrique A', numero: 6 })).toBe('Rubrique A#6');
    expect(cleQuestion({ section: 'Rubrique B', numero: 6 })).not.toBe(
      cleQuestion({ section: 'Rubrique A', numero: 6 }),
    );
  });
});
