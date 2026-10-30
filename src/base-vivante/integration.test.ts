import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { withInstance } from '../db/context.js';
import { createInstance } from '../instances/service.js';
import { FicheNonHomogene, integrerFiches, verifierHomogene } from './integration.js';
import { normaliserFiche, type Brut, type Fiche } from './nettoyage.js';

const fiche = (brut: Brut): Fiche => normaliserFiche(brut).fiche;
const item = (f: Fiche) => ({
  fiche: f,
  provenance: 'Test',
  mandat: null,
  importId: null,
  collecteLe: null,
});

describe('point d’entrée unique de la base vivante', () => {
  let t: TestApp;
  let instanceId: string;

  beforeAll(async () => {
    t = await setupTestApp();
    instanceId = (
      await createInstance(t.owner.db, { slug: 'bv-entree', nom: 'Entrée', type: 'mandat' })
    ).id;
  });
  afterAll(async () => {
    await t.drop();
  });

  const integrer = (...fiches: Fiche[]) =>
    withInstance(t.app.db, instanceId, (tx) => integrerFiches(tx, instanceId, fiches.map(item)));

  it('refuse une fiche incomplète', async () => {
    await expect(integrer(fiche({ nom: 'Durand' }))).rejects.toThrow(FicheNonHomogene);
  });

  it('refuse une fiche non normalisée', () => {
    const bonne = fiche({ entreprise: 'Acme', prenom: 'Léa', nom: 'Martin' });
    expect(() => verifierHomogene({ ...bonne, nom: 'martin' })).toThrow('non normalisée');
    expect(() => verifierHomogene({ ...bonne, email: 'LEA@Acme.test' })).toThrow('non normalisée');
    expect(() => verifierHomogene({ ...bonne, telephone: '06 12 34 56 78' })).toThrow(
      'non normalisée',
    );
    expect(verifierHomogene(bonne)).toBe('a_enrichir');
  });

  it('un lot refusé n’écrit rien', async () => {
    const bonne = fiche({ entreprise: 'Lot Fictif', nom: 'Bon', email: 'b@lot-fictif.test' });
    await expect(integrer(bonne, fiche({ nom: 'Sans entreprise' }))).rejects.toThrow(
      FicheNonHomogene,
    );
    const { rows } = await t.owner.pool.query<{ n: number }>(
      "select count(*)::int as n from base_vivante where entreprise = 'Lot Fictif'",
    );
    expect(rows[0]?.n).toBe(0);
  });

  it('fusionne deux fiches du même lot qui se recoupent', async () => {
    const a = fiche({
      entreprise: 'Fusion Fictive',
      prenom: 'Zoé',
      nom: 'Un',
      email: 'z@fusion.test',
    });
    const b = fiche({
      entreprise: 'Fusion Fictive',
      prenom: 'Zoé',
      nom: 'Un',
      telephone: '0611111111',
      email: 'z@fusion.test',
    });
    const [ra, rb] = await integrer(a, b);
    expect(rb).toMatchObject({ id: ra?.id, fusionnee: true });
    const { rows } = await t.owner.pool.query(
      "select telephone from base_vivante where entreprise = 'Fusion Fictive'",
    );
    expect(rows).toEqual([{ telephone: '+33611111111' }]);
  });

  it('seul integration.ts écrit dans base_vivante', () => {
    const racine = join(import.meta.dirname, '..');
    const fichiers: string[] = [];
    const parcourir = (dossier: string) => {
      for (const nom of readdirSync(dossier)) {
        const chemin = join(dossier, nom);
        if (statSync(chemin).isDirectory()) parcourir(chemin);
        else if (chemin.endsWith('.ts')) fichiers.push(chemin);
      }
    };
    parcourir(racine);
    const autorises = ['integration.ts', 'integration.test.ts'];
    const fautifs = fichiers
      .filter((f) => !autorises.some((a) => f.endsWith(a)))
      .filter((f) => /\.(insert|update|delete)\(\s*baseVivante\b/.test(readFileSync(f, 'utf8')));
    expect(fautifs).toEqual([]);
  });
});
