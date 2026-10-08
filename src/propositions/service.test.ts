import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { logEvent, recentEvents } from '../journal/service.js';
import { niveauAction, setNiveau } from './autonomie.js';
import { registerPropositionType, type ApplyCtx } from './registry.js';
import { canWriteReal, decide, propose, PropositionRefusee } from './service.js';

type Note = { texte: string };
const applied: { contenu: Note; ctx: ApplyCtx }[] = [];
let failNext = false;

registerPropositionType<Note>({
  type: 'test.note',
  action: 'brouillon',
  schema: z.object({ texte: z.string().min(1) }),
  apply: async (tx, contenu, ctx) => {
    if (failNext) {
      // Written inside apply, then the apply fails: this event must be rolled back.
      await logEvent(tx, { acteur: 'os', action: 'trace avant échec' });
      throw new Error('outil tiers indisponible');
    }
    applied.push({ contenu, ctx });
    return { ok: true };
  },
});

describe('propositions and autonomy', () => {
  let t: TestApp;
  let a: Instance;
  let b: Instance;

  const inA = <T>(fn: Parameters<typeof withInstance<T>>[2]) => withInstance(t.app.db, a.id, fn);
  const ctxA = (realWrites = false) => ({ instance: a, realWrites });

  beforeAll(async () => {
    t = await setupTestApp();
    a = await createInstance(t.owner.db, { slug: 'a', nom: 'A', type: 'mandat' });
    b = await createInstance(t.owner.db, { slug: 'b', nom: 'B', type: 'mandat' });
  });

  afterAll(async () => {
    await t.drop();
  });

  beforeEach(async () => {
    applied.length = 0;
    failNext = false;
    await inA((tx) => setNiveau(tx, 'brouillon', 'L1', 'pilote'));
  });

  it('keeps an L1 proposal waiting for the pilot, without applying it', async () => {
    const p = await inA((tx) =>
      propose(tx, ctxA(), { type: 'test.note', contenu: { texte: 'Relancer' }, auteur: 'os' }),
    );
    expect(p).toMatchObject({ statut: 'proposee', niveau: 'L1', auteur: 'os' });
    expect(applied).toHaveLength(0);
  });

  it('applies an L3 proposal at once, decided by the OS', async () => {
    await inA((tx) => setNiveau(tx, 'brouillon', 'L3', 'pilote'));
    const p = await inA((tx) =>
      propose(tx, ctxA(), { type: 'test.note', contenu: { texte: 'Seul' }, auteur: 'agent:test' }),
    );
    expect(p).toMatchObject({ statut: 'appliquee', decidePar: 'os', resultat: { ok: true } });
    expect(applied).toHaveLength(1);
  });

  it('refuses a proposal when the action is at L0', async () => {
    await inA((tx) => setNiveau(tx, 'brouillon', 'L0', 'pilote'));
    await expect(
      inA((tx) =>
        propose(tx, ctxA(), { type: 'test.note', contenu: { texte: 'Non' }, auteur: 'os' }),
      ),
    ).rejects.toBeInstanceOf(PropositionRefusee);
  });

  it('rejects content that does not match the type schema', async () => {
    await expect(
      inA((tx) => propose(tx, ctxA(), { type: 'test.note', contenu: { texte: '' }, auteur: 'os' })),
    ).rejects.toThrow();
  });

  it('never lets the author validate its own proposal', async () => {
    const p = await inA((tx) =>
      propose(tx, ctxA(), { type: 'test.note', contenu: { texte: 'Moi' }, auteur: 'pilote' }),
    );
    await expect(
      inA((tx) => decide(tx, ctxA(), p.id, { decision: 'valider', par: 'pilote' })),
    ).rejects.toBeInstanceOf(PropositionRefusee);
  });

  it('applies on validation, with the edited content, and refuses a second decision', async () => {
    const p = await inA((tx) =>
      propose(tx, ctxA(), { type: 'test.note', contenu: { texte: 'Avant' }, auteur: 'os' }),
    );
    const done = await inA((tx) =>
      decide(tx, ctxA(), p.id, { decision: 'valider', par: 'pilote', contenu: { texte: 'Après' } }),
    );
    expect(done).toMatchObject({ statut: 'appliquee', decidePar: 'pilote' });
    expect(applied.map((x) => x.contenu.texte)).toEqual(['Après']);
    await expect(
      inA((tx) => decide(tx, ctxA(), p.id, { decision: 'ecarter', par: 'pilote' })),
    ).rejects.toThrow(/déjà traitée/);
  });

  it('applies nothing when the pilot discards', async () => {
    const p = await inA((tx) =>
      propose(tx, ctxA(), { type: 'test.note', contenu: { texte: 'Bof' }, auteur: 'os' }),
    );
    const done = await inA((tx) =>
      decide(tx, ctxA(), p.id, { decision: 'ecarter', par: 'pilote' }),
    );
    expect(done.statut).toBe('ecartee');
    expect(applied).toHaveLength(0);
  });

  it('records a failed apply as echec and rolls back what the apply wrote', async () => {
    const p = await inA((tx) =>
      propose(tx, ctxA(), { type: 'test.note', contenu: { texte: 'Panne' }, auteur: 'os' }),
    );
    failNext = true;
    const done = await inA((tx) =>
      decide(tx, ctxA(), p.id, { decision: 'valider', par: 'pilote' }),
    );
    expect(done).toMatchObject({
      statut: 'echec',
      resultat: { erreur: 'outil tiers indisponible' },
    });
    const actions = (await inA((tx) => recentEvents(tx, 200))).map((e) => e.action);
    expect(actions).not.toContain('trace avant échec');
    expect(actions).toContain('Échec de la proposition : test.note');
  });

  it('only writes for real when both locks are on', async () => {
    await inA((tx) => setNiveau(tx, 'brouillon', 'L3', 'pilote'));
    const run = (realWrites: boolean) =>
      inA((tx) =>
        propose(tx, ctxA(realWrites), {
          type: 'test.note',
          contenu: { texte: 'x' },
          auteur: 'os',
        }),
      );
    await run(true);
    expect(applied[0]?.ctx.reel).toBe(false);

    const armed = { ...a, config: { ...a.config, ecrituresReelles: true } };
    expect(canWriteReal(armed, false)).toBe(false);
    expect(canWriteReal(armed, true)).toBe(true);
    expect(canWriteReal(a, true)).toBe(false);
  });

  it('logs every transition in the journal', async () => {
    const before = (await inA((tx) => recentEvents(tx, 500))).length;
    const p = await inA((tx) =>
      propose(tx, ctxA(), { type: 'test.note', contenu: { texte: 'Trace' }, auteur: 'os' }),
    );
    await inA((tx) => decide(tx, ctxA(), p.id, { decision: 'valider', par: 'pilote' }));
    const after = (await inA((tx) => recentEvents(tx, 500))).length;
    expect(after - before).toBe(2);
  });

  it('keeps locked limits: sending stays at L2, quotes never above L1, deletion forbidden', async () => {
    await expect(inA((tx) => setNiveau(tx, 'envoi', 'L3', 'pilote'))).rejects.toThrow(
      /hors limites/,
    );
    await expect(inA((tx) => setNiveau(tx, 'envoi', 'L1', 'pilote'))).rejects.toThrow(
      /hors limites/,
    );
    await expect(inA((tx) => setNiveau(tx, 'devis', 'L2', 'pilote'))).rejects.toThrow(
      /hors limites/,
    );
    await expect(inA((tx) => setNiveau(tx, 'suppr', 'L1', 'pilote'))).rejects.toThrow(/interdite/);
    expect(await inA((tx) => niveauAction(tx, 'envoi'))).toBe('L2');
  });

  it('keeps autonomy settings and proposals per instance', async () => {
    await inA((tx) => setNiveau(tx, 'brouillon', 'L3', 'pilote'));
    expect(await withInstance(t.app.db, b.id, (tx) => niveauAction(tx, 'brouillon'))).toBe('L1');

    const p = await inA((tx) =>
      propose(tx, ctxA(), {
        type: 'test.note',
        contenu: { texte: 'A seulement' },
        auteur: 'agent:x',
      }),
    );
    await expect(
      withInstance(t.app.db, b.id, (tx) =>
        decide(tx, { instance: b, realWrites: false }, p.id, {
          decision: 'valider',
          par: 'pilote',
        }),
      ),
    ).rejects.toThrow(/introuvable/);
  });
});
