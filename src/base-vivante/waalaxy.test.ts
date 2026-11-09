import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { integrerFiches } from './integration.js';
import { normaliserFiche, type Brut } from './nettoyage.js';
import { registerBaseVivanteRoutes } from './routes.js';
import { modifierConformite } from './service.js';
import { COLONNES_WAALAXY, exporterWaalaxy } from './waalaxy.js';

describe('base vivante : export Waalaxy', () => {
  let t: TestApp;
  let base: Instance;

  beforeAll(async () => {
    t = await setupTestApp();
    base = await createInstance(t.owner.db, { slug: 'bv-waalaxy', nom: 'Base', type: 'propre' });
  });
  afterAll(async () => {
    await t.drop();
  });
  beforeEach(async () => {
    for (const table of ['base_lignes_brutes', 'base_vivante', 'base_imports'])
      await t.owner.pool.query(`delete from ${table}`);
  });

  const integrer = async (...brutes: Brut[]) => {
    const res = await withInstance(t.app.db, base.id, (tx) =>
      integrerFiches(
        tx,
        base.id,
        brutes.map((b) => ({
          fiche: normaliserFiche(b).fiche,
          provenance: 'Sharp',
          mandat: null,
          importId: null,
          collecteLe: null,
        })),
      ),
    );
    return res.map((r) => r.id);
  };
  const lignes = (csv: string) => csv.trim().split('\r\n');

  it('ne garde que les profils /in/ et écrit les colonnes attendues', async () => {
    await integrer(
      {
        entreprise: 'A Fictif',
        prenom: 'Léa',
        nom: 'Martin',
        fonction: 'Directrice',
        email: 'lea@a.test',
        linkedin: 'https://fr.linkedin.com/in/lea-martin?trk=x',
      },
      { entreprise: 'B Fictif', nom: 'Deux', linkedin: 'https://linkedin.com/company/b-fictif' },
      { entreprise: 'C Fictif', nom: 'Trois', email: 'trois@c.test' },
    );
    const { csv, apercu } = await exporterWaalaxy(t.app.db, base.id);
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
    expect(lignes(csv)).toEqual([
      COLONNES_WAALAXY.join(','),
      'https://www.linkedin.com/in/lea-martin,Léa,MARTIN,Directrice,A Fictif,lea@a.test',
    ]);
    expect(apercu).toEqual({
      retenues: 1,
      parties: 1,
      ecartees: { opposition: 0, exclusion: 0, sansProfil: 2 },
    });
  });

  it('écarte les oppositions et les exclus, et les compte', async () => {
    const [a, b] = await integrer(
      { entreprise: 'A Fictif', nom: 'Un', linkedin: 'https://linkedin.com/in/un' },
      { entreprise: 'B Fictif', nom: 'Deux', linkedin: 'https://linkedin.com/in/deux' },
      { entreprise: 'C Fictif', nom: 'Trois', linkedin: 'https://linkedin.com/in/trois' },
    );
    await modifierConformite(t.app.db, base.id, a ?? '', { opposition: true });
    await modifierConformite(t.app.db, base.id, b ?? '', { exclusion: 'client' });
    const { csv, apercu } = await exporterWaalaxy(t.app.db, base.id);
    expect(lignes(csv)).toHaveLength(2);
    expect(csv).toContain('/in/trois');
    expect(csv).not.toContain('/in/un');
    expect(csv).not.toContain('/in/deux');
    expect(apercu.ecartees).toEqual({ opposition: 1, exclusion: 1, sansProfil: 0 });
  });

  it('vide les e-mails génériques ou en erreur, protège les formules et les virgules', async () => {
    const [b] = await integrer(
      {
        entreprise: '=CMD("x")',
        nom: 'Un',
        fonction: 'Dir, gén',
        email: 'un@a.test',
        linkedin: 'https://linkedin.com/in/un',
      },
      {
        entreprise: 'B Fictif',
        nom: 'Deux',
        email: 'contact@b.test',
        linkedin: 'https://linkedin.com/in/deux',
      },
    );
    await modifierConformite(t.app.db, base.id, b ?? '', { emailInvalide: true });
    const { csv } = await exporterWaalaxy(t.app.db, base.id);
    const [, un, deux] = lignes(csv);
    expect(un).toBe('https://www.linkedin.com/in/un,,UN,"Dir, gén","\'=CMD(""x"")",');
    expect(deux).toBe('https://www.linkedin.com/in/deux,,DEUX,,B Fictif,');
  });

  it('applique les filtres de l’écran', async () => {
    await integrer(
      { entreprise: 'A Fictif', nom: 'Un', linkedin: 'https://linkedin.com/in/un' },
      { entreprise: 'B Fictif', nom: 'Deux', linkedin: 'https://linkedin.com/in/deux' },
    );
    const { csv } = await exporterWaalaxy(t.app.db, base.id, { q: 'deux' });
    expect(lignes(csv)).toHaveLength(2);
    expect(csv).toContain('/in/deux');
  });

  it('découpe en fichiers de taille limitée', async () => {
    await integrer(
      ...['un', 'deux', 'trois'].map((nom) => ({
        entreprise: `${nom} Fictif`,
        nom,
        linkedin: `https://linkedin.com/in/${nom}`,
      })),
    );
    const un = await exporterWaalaxy(t.app.db, base.id, {}, 1, 2);
    const deux = await exporterWaalaxy(t.app.db, base.id, {}, 2, 2);
    expect(un.apercu.parties).toBe(2);
    expect(lignes(un.csv)).toHaveLength(3);
    expect(lignes(deux.csv)).toHaveLength(2);
    expect(un.csv).not.toContain(lignes(deux.csv)[1] ?? 'absent');
  });

  it('expose l’aperçu et le fichier par l’API, avec un téléchargement CSV', async () => {
    await integrer(
      { entreprise: 'A Fictif', nom: 'Un', linkedin: 'https://linkedin.com/in/un' },
      { entreprise: 'B Fictif', nom: 'Deux' },
    );
    const a = Fastify();
    registerBaseVivanteRoutes(a, { db: t.app.db });
    const apercu = await a.inject({ method: 'GET', url: '/api/i/bv-waalaxy/base/export-waalaxy' });
    expect(apercu.json()).toEqual({
      retenues: 1,
      parties: 1,
      ecartees: { opposition: 0, exclusion: 0, sansProfil: 1 },
    });
    const fichier = await a.inject({
      method: 'GET',
      url: '/api/i/bv-waalaxy/base/export-waalaxy.csv?partie=1',
    });
    expect(fichier.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(fichier.headers['content-disposition']).toBe('attachment; filename="waalaxy-1.csv"');
    expect(fichier.body).toContain('https://www.linkedin.com/in/un');
    const inconnue = await a.inject({ method: 'GET', url: '/api/i/inconnue/base/export-waalaxy' });
    expect(inconnue.statusCode).toBe(404);
  });
});
