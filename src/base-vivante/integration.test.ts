import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { withInstance } from '../db/context.js';
import { createInstance } from '../instances/service.js';
import {
  appliquerContact,
  FicheNonHomogene,
  integrerFiches,
  verifierHomogene,
} from './integration.js';
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

describe('application d’un contact trouvé par l’enrichissement', () => {
  let t: TestApp;
  let instanceId: string;

  beforeAll(async () => {
    t = await setupTestApp();
    instanceId = (
      await createInstance(t.owner.db, { slug: 'bv-apport', nom: 'Apport', type: 'mandat' })
    ).id;
  });
  afterAll(async () => {
    await t.drop();
  });

  const integrer = async (f: Fiche) =>
    (
      await withInstance(t.app.db, instanceId, (tx) => integrerFiches(tx, instanceId, [item(f)]))
    )[0]!;
  const appliquer = (id: string, apport: Parameters<typeof appliquerContact>[3]) =>
    withInstance(t.app.db, instanceId, (tx) => appliquerContact(tx, instanceId, id, apport));
  const fiches = async (entreprise: string) =>
    (
      await t.owner.pool.query<Record<string, string | null>>(
        'select prenom, nom, email, telephone, zone from base_vivante where entreprise = $1 order by created_at',
        [entreprise],
      )
    ).rows;

  it('une entreprise sans contact reçoit le contact : même fiche, prospectable', async () => {
    const { id } = await integrer(fiche({ entreprise: 'Atelier Fictif' }));
    const r = await appliquer(id, {
      prenom: 'Claire',
      nom: 'Martin',
      email: 'claire@atelier-fictif.test',
    });
    expect(r).toMatchObject({ id, zone: 'prospectable', creee: false });
    expect(await fiches('Atelier Fictif')).toHaveLength(1);
  });

  it('un second contact de la même entreprise crée une nouvelle fiche, la première intacte', async () => {
    const { id } = await integrer(fiche({ entreprise: 'Bureau Fictif' }));
    await appliquer(id, { prenom: 'Claire', nom: 'MARTIN', email: 'claire@bureau-fictif.test' });
    const r = await appliquer(id, { prenom: 'Paul', nom: 'PETIT', telephone: '04 50 12 34 56' });
    expect(r).toMatchObject({ creee: true, zone: 'prospectable' });
    expect(r.id).not.toBe(id);
    expect(await fiches('Bureau Fictif')).toEqual([
      expect.objectContaining({ nom: 'MARTIN', email: 'claire@bureau-fictif.test' }),
      expect.objectContaining({ nom: 'PETIT', telephone: '+33450123456' }),
    ]);
  });

  it('la même personne n’est complétée que dans ses champs vides, jamais écrasée', async () => {
    const { id } = await integrer(
      fiche({
        entreprise: 'Cabinet Fictif',
        prenom: 'Claire',
        nom: 'Martin',
        email: 'claire@cabinet-fictif.test',
      }),
    );
    const r = await appliquer(id, {
      prenom: 'Claire',
      nom: 'Martin',
      email: 'autre@cabinet-fictif.test',
      telephone: '04 50 12 34 56',
    });
    expect(r).toMatchObject({ id, creee: false });
    expect(await fiches('Cabinet Fictif')).toEqual([
      expect.objectContaining({ email: 'claire@cabinet-fictif.test', telephone: '+33450123456' }),
    ]);
  });

  it('une personne déjà présente sur une autre fiche de l’entreprise ne crée pas de doublon', async () => {
    const { id } = await integrer(fiche({ entreprise: 'Garage Fictif' }));
    await appliquer(id, { prenom: 'Zoé', nom: 'Roux', email: 'zoe@garage-fictif.test' });
    const r = await appliquer(id, { prenom: 'Zoé', nom: 'Roux', telephone: '04 50 12 34 56' });
    expect(r.creee).toBe(false);
    expect(await fiches('Garage Fictif')).toHaveLength(1);
  });
});
