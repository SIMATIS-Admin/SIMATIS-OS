import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../../test/database.js';
import { archiverEtPurger } from './archive.js';
import { iaArchive, iaCumuls, iaJauges } from './schema.js';
import { enregistrerReleve } from './service.js';

async function cumul(t: TestApp, id: string, heure: string) {
  await enregistrerReleve(t.app.db, {
    passage: heure,
    anomalies: 0,
    sessions: [
      {
        id: `claude:${id}`,
        fournisseur: 'claude',
        outil: 'code',
        sujet: `Sujet ${id}`,
        branche: null,
        titre: null,
        cwd: null,
        debut: heure,
      },
    ],
    cumuls: [
      {
        sessionId: `claude:${id}`,
        heure,
        modele: 'claude-sonnet-5-5',
        entree: 500_000,
        sortie: 0,
        cacheEcriture: 0,
        cacheLecture: 0,
      },
    ],
    jauges: [],
  });
}

describe('archiverEtPurger', () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await setupTestApp();
  });
  afterEach(async () => {
    await t.drop();
  });

  it('fige la veille une seule fois', async () => {
    await cumul(t, 'a', '2026-11-09T10:00:00.000Z');
    const maintenant = new Date('2026-11-10T02:00:00.000Z');
    expect((await archiverEtPurger(t.app.db, maintenant)).jours).toEqual(['2026-11-09']);
    expect((await archiverEtPurger(t.app.db, maintenant)).jours).toEqual([]);
    const lignes = await t.app.db.select().from(iaArchive);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({
      jour: '2026-11-09',
      origine: 'ext',
      sujet: 'Sujet a',
      entree: 500_000,
      l5: null,
    });
  });

  it('rattrape un jour manqué', async () => {
    await cumul(t, 'a', '2026-11-07T10:00:00.000Z');
    await cumul(t, 'b', '2026-11-09T10:00:00.000Z');
    const { jours } = await archiverEtPurger(t.app.db, new Date('2026-11-10T02:00:00.000Z'));
    expect(jours).toEqual(['2026-11-07', '2026-11-08', '2026-11-09']);
    expect(await t.app.db.select().from(iaArchive)).toHaveLength(2);
  });

  it('les valeurs archivées ne changent plus quand le coefficient évolue', async () => {
    await cumul(t, 'a', '2026-11-09T10:00:00.000Z');
    await archiverEtPurger(t.app.db, new Date('2026-11-10T02:00:00.000Z'));
    await t.app.db.insert(iaJauges).values([
      {
        fournisseur: 'claude',
        at: new Date('2026-11-09T09:55:00.000Z'),
        source: 'collecteur',
        utilise5h: 0,
        utiliseHebdo: 0,
      },
      {
        fournisseur: 'claude',
        at: new Date('2026-11-09T10:55:00.000Z'),
        source: 'collecteur',
        utilise5h: 8,
        utiliseHebdo: 8,
      },
    ]);
    await archiverEtPurger(t.app.db, new Date('2026-11-11T02:00:00.000Z'));
    const [ligne] = await t.app.db.select().from(iaArchive);
    expect(ligne?.l5).toBeNull();
  });

  it('n’archive pas avant 1 h du matin', async () => {
    await cumul(t, 'a', '2026-11-09T10:00:00.000Z');
    // 00 h 30 à Paris le 10 novembre.
    const { jours } = await archiverEtPurger(t.app.db, new Date('2026-11-09T23:30:00.000Z'));
    expect(jours).toEqual([]);
  });

  it('purge au-delà de 13 mois et de 90 jours', async () => {
    await cumul(t, 'vieux', '2026-08-01T10:00:00.000Z');
    await cumul(t, 'recent', '2026-11-09T10:00:00.000Z');
    await t.app.db.insert(iaArchive).values({
      jour: '2025-09-01',
      heure: new Date('2025-09-01T10:00:00.000Z'),
      origine: 'ext',
      fournisseur: 'claude',
      outil: 'code',
      sujet: 'Ancien',
      entree: 1,
      sortie: 0,
      cacheEcriture: 0,
      cacheLecture: 0,
      cout: 0,
      estime: false,
    });
    await archiverEtPurger(t.app.db, new Date('2026-11-10T02:00:00.000Z'));
    const archive = await t.app.db.select().from(iaArchive);
    expect(archive.some((l) => l.sujet === 'Ancien')).toBe(false);
    const cumuls = await t.app.db.select().from(iaCumuls);
    expect(cumuls.map((c) => c.sessionId)).toEqual(['claude:recent']);
  });
});
