import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { buildApp } from '../app.js';
import { configureConnexion } from '../connexions/service.js';
import { withInstance } from '../db/context.js';
import { createInstance, getInstanceBySlug } from '../instances/service.js';
import { createToken } from '../mcp/tokens.js';
import { tour } from '../runner/runner.js';
import { planifier } from './planification.js';
import { santeRoutines, signalerPoste } from './sante.js';
import { demanderExecution, terminerExecution } from './service.js';

type Sante = Awaited<ReturnType<typeof santeRoutines>>;

describe('routine health check', () => {
  let t: TestApp;
  let app: FastifyInstance;
  let base: string;

  const sante = async (slug: string) =>
    (await app.inject({ method: 'GET', url: `/api/i/${slug}/routines/sante` })).json<Sante>();
  const routine = (s: Sante, cle: string) => {
    const r = s.routines.find((x) => x.cle === cle);
    if (!r) throw new Error(cle);
    return r;
  };
  const etat = (s: Sante, cle: string, id: string) =>
    routine(s, cle).controles.find((c) => c.id === id)?.etat;

  beforeAll(async () => {
    t = await setupTestApp();
    await createInstance(t.owner.db, { slug: 'mandat-a', nom: 'Mandat A', type: 'mandat' });
    app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test' });
    base = await app.listen({ host: '127.0.0.1', port: 0 });
  });

  afterAll(async () => {
    await app.close();
    await t.drop();
  });

  it('says the runner never ran: red light, skill unknown', async () => {
    const s = await sante('mandat-a');
    expect(s.executeur.actif).toBe(false);
    expect(routine(s, 'quotidienne').feu).toBe('manque');
    expect(etat(s, 'quotidienne', 'executeur')).toBe('manque');
    expect(routine(s, 'quotidienne').resume).toBe(
      "Chaque jour ouvré à 7h00, prépare au plus 20 relances par email et prépare le planning d'appels, avec 3 créneaux proposés à partir de J+3. Tâches reprises jusqu'à 30 jours de retard.",
    );
  });

  it('records the runner’s sign of life, Claude version and skills', async () => {
    const { token } = await createToken(t.owner.db, { nom: 'runner', portee: 'runner' });
    await tour({
      base,
      token,
      claude: 'claude',
      lancer: () => Promise.resolve(0),
      poste: () =>
        Promise.resolve({
          nom: 'mac-de-marc',
          claude: '2.1.295 (Claude Code)',
          skills: ['relance-quotidienne'],
        }),
    });
    const s = await sante('mandat-a');
    expect(s.executeur).toMatchObject({ actif: true, poste: 'mac-de-marc' });
    expect(etat(s, 'quotidienne', 'claude')).toBe('ok');
    expect(etat(s, 'quotidienne', 'skill')).toBe('ok');
    expect(etat(s, 'hebdo', 'skill')).toBe('manque');
    expect(routine(s, 'hebdo').feu).toBe('manque');
  });

  it('flags the missing connections and the steps they block', async () => {
    let s = await sante('mandat-a');
    const q = routine(s, 'quotidienne');
    expect(q.feu).toBe('attention');
    expect(etat(s, 'quotidienne', 'messagerie')).toBe('attention');
    expect(q.etapes.filter((e) => e.bloquee).map((e) => e.besoin)).toEqual([
      'messagerie',
      'agenda',
      'messagerie',
    ]);

    const a = await getInstanceBySlug(t.app.db, 'mandat-a');
    if (!a) throw new Error('no instance');
    await withInstance(t.app.db, a.id, async (tx) => {
      await configureConnexion(tx, { kind: 'messagerie', fournisseur: 'gmail', reglages: {} });
      await configureConnexion(tx, { kind: 'agenda', fournisseur: 'google-agenda', reglages: {} });
    });
    s = await sante('mandat-a');
    expect(routine(s, 'quotidienne').feu).toBe('ok');
    expect(routine(s, 'quotidienne').etapes.some((e) => e.bloquee)).toBe(false);
  });

  it('turns red again when the runner has been silent for more than two minutes', async () => {
    const a = await getInstanceBySlug(t.app.db, 'mandat-a');
    if (!a) throw new Error('no instance');
    await signalerPoste(
      t.app.db,
      { nom: 'mac-de-marc', claude: '2.1', skills: ['relance-quotidienne'] },
      new Date(Date.now() - 10 * 60_000),
    );
    const s = await santeRoutines(t.app.db, a);
    expect(s.executeur.actif).toBe(false);
    expect(routine(s, 'quotidienne').feu).toBe('manque');
  });

  it('runs the cleanup once after today’s daily run ended', async () => {
    const a = await getInstanceBySlug(t.app.db, 'mandat-a');
    if (!a) throw new Error('no instance');
    await withInstance(t.app.db, a.id, async (tx) => {
      const e = await demanderExecution(tx, 'quotidienne', 'pilote');
      await terminerExecution(tx, e.id, { fait: ['ok'], attente: [], echec: [] }, 'test');
    });
    // Before 7:00 in Paris (no daily request), right after the run.
    const tot = new Date();
    await planifier(t.app.db, tot);
    const { rows } = await t.owner.pool.query<{ n: number }>(
      "select count(*)::int as n from executions where routine = 'nettoyage' and instance_id = $1",
      [a.id],
    );
    expect(rows[0]?.n).toBe(1);
    await planifier(t.app.db, tot);
    const again = await t.owner.pool.query<{ n: number }>(
      "select count(*)::int as n from executions where routine = 'nettoyage' and instance_id = $1",
      [a.id],
    );
    expect(again.rows[0]?.n).toBe(1);
  });
});
