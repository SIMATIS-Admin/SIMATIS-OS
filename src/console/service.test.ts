import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { withInstance } from '../db/context.js';
import { instances } from '../instances/schema.js';
import { logEvent } from '../journal/service.js';
import type { Execution } from '../routines/schema.js';
import { demanderExecution, demarrerExecution, terminerExecution } from '../routines/service.js';
import { fusionnerConsole, lireConsole } from './service.js';

const run = (p: Partial<Execution>): Execution => ({
  id: 'r1',
  instanceId: 'i',
  source: 'natif',
  sourceId: null,
  createdAt: new Date('2026-10-22T08:00:00Z'),
  updatedAt: new Date('2026-10-22T08:00:00Z'),
  routine: 'inbox',
  statut: 'terminee',
  demandePar: 'pilote',
  debut: null,
  fin: new Date('2026-10-22T08:05:00Z'),
  etapes: [],
  rapport: null,
  ...p,
});

describe('fusionnerConsole', () => {
  it('turns a closed report into one line per point, with its level', () => {
    const { lignes } = fusionnerConsole(
      [],
      [
        run({
          rapport: {
            fait: ['Mails lus'],
            attente: ['Test de VMA reçu : non rangé'],
            echec: ['Fiche introuvable'],
          },
        }),
      ],
    );
    expect(lignes.map((l) => [l.niveau, l.texte])).toEqual([
      ['info', 'Routine « inbox » demandée par pilote'],
      ['ok', 'Routine « inbox » terminée'],
      ['ok', 'Mails lus'],
      ['attention', 'Test de VMA reçu : non rangé'],
      ['erreur', 'Fiche introuvable'],
    ]);
  });

  it('marks a failed run as an error, and an open run as in progress', () => {
    expect(fusionnerConsole([], [run({ statut: 'echouee' })]).lignes.at(-1)).toMatchObject({
      niveau: 'erreur',
      texte: 'Routine « inbox » échouée',
    });
    const ouverte = fusionnerConsole(
      [],
      [run({ statut: 'en_cours', fin: null, debut: new Date('2026-10-22T08:01:00Z') })],
    );
    expect(ouverte.enCours).toBe(true);
    expect(ouverte.lignes.at(-1)?.texte).toMatch(/Claude travaille/);
    expect(fusionnerConsole([], [run({})]).enCours).toBe(false);
  });

  it('warns when a request nobody took stays unanswered for two minutes', () => {
    const demandee = run({ statut: 'demandee', fin: null });
    const avant = fusionnerConsole([], [demandee], new Date('2026-10-22T08:01:00Z'));
    expect(avant.lignes.some((l) => /ne répond pas/.test(l.texte))).toBe(false);
    const apres = fusionnerConsole([], [demandee], new Date('2026-10-22T08:03:00Z'));
    expect(apres.lignes.at(-1)).toMatchObject({ niveau: 'attention' });
    expect(apres.lignes.at(-1)?.texte).toMatch(/ne répond pas/);
    expect(apres.enCours).toBe(true);
  });

  it('mixes journal and routines, oldest first', () => {
    const { lignes } = fusionnerConsole(
      [
        {
          id: 7,
          instanceId: 'i',
          at: new Date('2026-10-22T07:00:00Z'),
          acteur: 'pilote',
          action: 'Tâche créée : Appeler',
          niveau: 'L2',
          details: {},
        },
      ],
      [run({})],
    );
    expect(lignes[0]).toMatchObject({
      source: 'journal',
      acteur: 'pilote',
      texte: 'Tâche créée : Appeler',
    });
    expect(lignes.at(-1)?.source).toBe('routine');
  });
});

describe('lireConsole', () => {
  let t: TestApp;
  let a: string;
  let b: string;

  beforeAll(async () => {
    t = await setupTestApp();
    const rows = await t.owner.db
      .insert(instances)
      .values([
        { slug: 'a', nom: 'A', type: 'mandat' },
        { slug: 'b', nom: 'B', type: 'mandat' },
      ])
      .returning({ id: instances.id });
    a = rows[0]?.id ?? '';
    b = rows[1]?.id ?? '';
    await withInstance(t.app.db, a, async (tx) => {
      await logEvent(tx, { acteur: 'os', action: 'Événement A' });
      const x = await demanderExecution(tx, 'inbox', 'pilote');
      await demarrerExecution(tx, x.id);
      await terminerExecution(tx, x.id, { fait: ['Fait A'], attente: [], echec: [] }, 'agent:test');
    });
    await withInstance(t.app.db, b, (tx) => logEvent(tx, { acteur: 'os', action: 'Événement B' }));
  });

  afterAll(async () => {
    await t.drop();
  });

  it('reads journal and runs of the instance only', async () => {
    const { lignes, enCours } = await withInstance(t.app.db, a, (tx) => lireConsole(tx));
    const textes = lignes.map((l) => l.texte);
    expect(textes).toContain('Événement A');
    expect(textes).toContain('Fait A');
    expect(textes).not.toContain('Événement B');
    expect(enCours).toBe(false);
  });

  it('keeps only the last 24 hours', async () => {
    const demain = new Date(Date.now() + 25 * 3_600_000);
    const { lignes } = await withInstance(t.app.db, a, (tx) => lireConsole(tx, demain));
    expect(lignes).toEqual([]);
  });
});
