import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import '../pilotage/types-propositions.js';
import { decide, propose } from '../propositions/service.js';
import { deposerSujet } from './depot.js';
import { marquerReporte, sujetsTraites } from './report.js';
import { marquerTraite } from './service.js';

describe('Inbox : report des sujets traités', () => {
  let t: TestApp;
  let a: Instance;
  let b: Instance;

  const deposer = (i: Instance, cle: string) =>
    withInstance(t.app.db, i.id, (tx) =>
      deposerSujet(tx, {
        type: 'mail_a_repondre',
        titre: `Sujet ${cle}`,
        origine: 'messagerie',
        source: 'routine',
        sourceId: cle,
      }),
    );
  const traites = (i: Instance) => withInstance(t.app.db, i.id, (tx) => sujetsTraites(tx));
  const note = async (titre: string, decision: 'valider' | 'ecarter') => {
    const ctx = { instance: a, realWrites: false };
    const p = await withInstance(t.app.db, a.id, (tx) =>
      propose(tx, ctx, {
        type: 'note.second_cerveau',
        contenu: { titre, texte: 'Texte fictif', destination: 'Fiche fictive' },
        auteur: 'os',
      }),
    );
    await withInstance(t.app.db, a.id, (tx) => decide(tx, ctx, p.id, { decision, par: 'pilote' }));
  };

  beforeAll(async () => {
    t = await setupTestApp();
    a = await createInstance(t.owner.db, { slug: 'report-a', nom: 'A', type: 'mandat' });
    b = await createInstance(t.owner.db, { slug: 'report-b', nom: 'B', type: 'mandat' });
  });

  afterAll(async () => {
    await t.drop();
  });

  it('lists treated subjects not yet reported, never those to handle', async () => {
    const fait = await deposer(a, 'fait');
    const ouvert = await deposer(a, 'ouvert');
    await marquerTraite(t.app.db, a, fait.id);
    const ids = (await traites(a)).map((s) => s.id);
    expect(ids).toContain(fait.id);
    expect(ids).not.toContain(ouvert.id);
    expect((await traites(a)).find((s) => s.id === fait.id)).toMatchObject({
      statut: 'traite',
      sourceId: 'fait',
      decision: null,
      note: null,
    });
  });

  it('gives the note content of a validated second-brain note', async () => {
    await note('Note validée', 'valider');
    expect((await traites(a)).find((s) => s.titre === 'Note validée')).toMatchObject({
      type: 'a_valider',
      decision: 'appliquee',
      note: { titre: 'Note validée', texte: 'Texte fictif', destination: 'Fiche fictive' },
    });
  });

  it('only flags a rejected note as treated, without its content', async () => {
    await note('Note écartée', 'ecarter');
    expect((await traites(a)).find((s) => s.titre === 'Note écartée')).toMatchObject({
      decision: 'ecartee',
      note: null,
    });
  });

  it('marks reported subjects once, ignoring other instances and subjects to handle', async () => {
    const fait = await deposer(a, 'reporte');
    await marquerTraite(t.app.db, a, fait.id);
    const ouvert = await deposer(a, 'encore-ouvert');
    const autre = await deposer(b, 'autre');
    await marquerTraite(t.app.db, b, autre.id);
    const marquer = (ids: string[]) =>
      withInstance(t.app.db, a.id, (tx) => marquerReporte(tx, ids));
    expect(await marquer([fait.id, ouvert.id, autre.id])).toBe(1);
    expect(await marquer([fait.id])).toBe(0);
    expect((await traites(a)).some((s) => s.id === fait.id)).toBe(false);
    expect((await traites(b)).some((s) => s.id === autre.id)).toBe(true);
  });
});
