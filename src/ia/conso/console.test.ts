import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../../test/database.js';
import { lignesConso } from './console.js';
import { eq } from 'drizzle-orm';
import { iaJauges, iaReleve, iaSessions } from './schema.js';
import { enregistrerReleve } from './service.js';

const MAINTENANT = new Date('2026-11-10T18:30:00.000Z');
const B = new Date('2026-11-10T08:00:00.000Z');
const h = (i: number, m = 0) => new Date(B.getTime() + i * 3_600_000 + m * 60_000);

// Sonnet 5.5 : 2 $ le million de jetons d'entrée, donc 500 000 jetons = 1 unité de coût.
async function session(t: TestApp, id: string, sujet: string, heures: [number, number][]) {
  await enregistrerReleve(t.app.db, {
    passage: MAINTENANT.toISOString(),
    anomalies: 0,
    sessions: [
      {
        id: `claude:${id}`,
        fournisseur: 'claude',
        outil: 'code',
        sujet,
        branche: null,
        titre: null,
        cwd: null,
        debut: h(heures[0]?.[0] ?? 0).toISOString(),
      },
    ],
    cumuls: heures.map(([i, cout]) => ({
      sessionId: `claude:${id}`,
      heure: h(i).toISOString(),
      modele: 'claude-sonnet-5-5',
      entree: cout * 500_000,
      sortie: 0,
      cacheEcriture: 0,
      cacheLecture: 0,
    })),
    jauges: [],
  });
}

async function jauges(t: TestApp, points: [Date, number][]) {
  await t.app.db.insert(iaJauges).values(
    points.map(([at, utilise]) => ({
      fournisseur: 'claude' as const,
      at,
      source: 'collecteur' as const,
      utilise5h: utilise,
      utiliseHebdo: utilise,
      reset5h: new Date('2026-11-11T00:00:00.000Z'),
      resetHebdo: new Date('2026-11-14T00:00:00.000Z'),
    })),
  );
}

describe('lignesConso', () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await setupTestApp();
  });
  afterEach(async () => {
    await t.drop();
  });

  it('une ligne par session, cumulée sur ses heures', async () => {
    await session(t, 'a', 'PR #7', [
      [1, 1],
      [2, 2],
    ]);
    await session(t, 'b', 'PR #7', [[1, 2]]);
    const lignes = await lignesConso(t.app.db, MAINTENANT);
    const pr = lignes.filter((l) => l.texte.includes('PR #7'));
    expect(pr).toHaveLength(2);
    const a = pr.find((l) => l.id === 'conso:claude:a');
    expect(a).toMatchObject({ source: 'conso', acteur: 'ia', at: h(2).toISOString() });
    expect(a?.texte).toMatch(/^IA-ext · Claude · Code · PR #7 · /);
  });

  it('étiquette les lignes IA-ext ou IA-int, jamais Info ni À voir', async () => {
    await session(t, 'a', 'PR #7', [[1, 1]]);
    await t.app.db.update(iaSessions).set({ origine: 'int' }).where(eq(iaSessions.id, 'claude:a'));
    await session(t, 'b', 'PR #8', [[1, 1]]);
    const lignes = await lignesConso(t.app.db, MAINTENANT);
    expect(lignes.find((l) => l.id === 'conso:claude:a')?.etiquette).toBe('IA-int');
    expect(lignes.find((l) => l.id === 'conso:claude:b')?.etiquette).toBe('IA-ext');
  });

  it('sans historique, convertit en % depuis la fenêtre en cours', async () => {
    await session(t, 'a', 'question', [[1, 3]]);
    // Une seule lecture : 12 % utilisés, fenêtre 5 h ouverte à h(0), semaine ouverte avant.
    await t.app.db.insert(iaJauges).values({
      fournisseur: 'claude',
      at: h(2),
      source: 'collecteur',
      utilise5h: 12,
      utiliseHebdo: 6,
      reset5h: h(5),
      resetHebdo: new Date('2026-11-14T00:00:00.000Z'),
    });
    const [ligne] = await lignesConso(t.app.db, MAINTENANT);
    expect(ligne?.texte).toBe('IA-ext · Claude · Code · question · L5 ≈ +12,0 % · LH ≈ +6,0 %');
  });

  it('jamais de jetons : sans aucune jauge, le % est en attente', async () => {
    await session(t, 'a', 'question', [[1, 3]]);
    const [ligne] = await lignesConso(t.app.db, MAINTENANT);
    expect(ligne?.texte).toBe('IA-ext · Claude · Code · question · L5 ? % · LH ? %');
  });

  it('marque ≈ sous 20 points', async () => {
    await session(t, 'a', 'PR #8', [[1, 2]]);
    await jauges(t, [
      [h(0, 55), 10],
      [h(1, 55), 14],
    ]);
    const ligne = (await lignesConso(t.app.db, MAINTENANT)).find((l) => l.texte.includes('PR #8'));
    expect(ligne?.texte).toContain('L5 ≈ +4,0 %');
    expect(ligne?.texte).toContain('LH ≈ +4,0 %');
  });

  it('passe en À VOIR à 10 points de L5', async () => {
    await session(t, 'a', 'Boucle fictive', [[1, 3]]);
    await jauges(t, [
      [h(0, 55), 10],
      [h(1, 55), 22],
    ]);
    const ligne = (await lignesConso(t.app.db, MAINTENANT)).find((l) =>
      l.texte.includes('Boucle fictive'),
    );
    expect(ligne?.niveau).toBe('attention');
  });

  it('affiche le non attribué', async () => {
    await session(
      t,
      'a',
      'PR #9',
      [0, 1, 2, 3, 4, 5, 6].map((i) => [i, 1]),
    );
    // 2 points par heure, et 5 de plus à la dernière heure : la part du Chat, invisible.
    const points: [Date, number][] = [[h(-1, 55), 0]];
    for (let i = 0; i <= 6; i++) points.push([h(i, 55), 2 * (i + 1) + (i === 6 ? 5 : 0)]);
    await jauges(t, points);
    const lignes = await lignesConso(t.app.db, MAINTENANT);
    const na = lignes.find((l) => l.texte.includes('non attribué'));
    expect(na?.texte).toBe('Claude · non attribué (Chat claude.ai ?) · L5 ≈ +5,0 % · LH ≈ +5,0 %');
    expect(na?.at).toBe(h(6).toISOString());
  });

  it('pas de non attribué pour une heure que le relevé n’a pas encore couverte', async () => {
    await session(
      t,
      'a',
      'PR #9',
      [0, 1, 2, 3, 4, 5, 6].map((i) => [i, 1]),
    );
    const points: [Date, number][] = [[h(-1, 55), 0]];
    for (let i = 0; i <= 6; i++) points.push([h(i, 55), 2 * (i + 1) + (i === 6 ? 5 : 0)]);
    await jauges(t, points);
    // Dernier passage du relevé au milieu de l'heure 6 : ses sessions ne sont peut-être pas toutes vues.
    await t.app.db.update(iaReleve).set({ dernierPassage: h(6, 30) });
    const lignes = await lignesConso(t.app.db, h(7, 10));
    expect(lignes.some((l) => l.texte.includes('non attribué'))).toBe(false);
  });

  it('signale un relevé muet depuis 15 minutes', async () => {
    await t.app.db.insert(iaReleve).values({
      id: 'mac',
      dernierPassage: new Date(MAINTENANT.getTime() - 20 * 60_000),
      anomalies: 3,
    });
    const lignes = await lignesConso(t.app.db, MAINTENANT);
    expect(lignes.find((l) => l.texte.includes('muet'))?.niveau).toBe('attention');
    expect(lignes.find((l) => l.texte.includes('3 lignes illisibles'))?.niveau).toBe('attention');
  });
});
