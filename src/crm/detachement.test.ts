import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { runCommand } from '../admin/cli.js';
import { connexions } from '../connexions/schema.js';
import { withInstance } from '../db/context.js';
import { instances, type Instance } from '../instances/schema.js';
import { createInstance, getInstanceBySlug } from '../instances/service.js';
import { getPipeline, pipelineSource } from './pipeline.js';
import { contacts, entreprises, opportunites, taches } from './schema.js';
import { updateTache } from './taches.js';

const ETAPES = [
  { id: '9001', label: '0 - Cible', ordre: 0, clos: false, gagne: false, probabilite: 1 },
  { id: '9002', label: '1 - Lead', ordre: 1, clos: false, gagne: false, probabilite: 5 },
  { id: '9009', label: '9 - Gagnée', ordre: 2, clos: true, gagne: true, probabilite: 100 },
];

describe('crm:detacher', () => {
  let t: TestApp;
  let a: Instance;
  let b: Instance;
  let dossier: string;
  let lignes: string[];
  const run = (...argv: string[]) => {
    lignes = [];
    return runCommand(argv, {
      db: t.owner.db,
      out: (l) => lignes.push(l),
      dossierSauvegarde: dossier,
    });
  };
  const compte = async (instance: Instance, source: string) =>
    (
      await t.owner.pool.query<{ n: string }>(
        `select (select count(*) from entreprises where instance_id = $1 and source = $2)
          + (select count(*) from taches where instance_id = $1 and source = $2)
          + (select count(*) from opportunites where instance_id = $1 and source = $2) as n`,
        [instance.id, source],
      )
    ).rows[0]?.n;

  const brancher = (instance: Instance) =>
    t.owner.db.insert(connexions).values({
      instanceId: instance.id,
      kind: 'crm',
      fournisseur: 'hubspot',
      reglages: { sens: 'deux_sens', frequence: '3h', etapes: ETAPES },
      etat: 'ok',
    });
  const remplir = async (instance: Instance) => {
    const [e] = await t.owner.db
      .insert(entreprises)
      .values([
        { instanceId: instance.id, nom: 'Société fictive HS', source: 'hubspot', sourceId: 'e1' },
        { instanceId: instance.id, nom: 'Société fictive OS' },
      ])
      .returning({ id: entreprises.id });
    await t.owner.db.insert(contacts).values({
      instanceId: instance.id,
      nom: 'Camille Exemple',
      source: 'hubspot',
      sourceId: 'c1',
    });
    await t.owner.db.insert(opportunites).values({
      instanceId: instance.id,
      titre: 'Affaire fictive',
      etape: '9002',
      entrepriseId: e?.id,
      source: 'hubspot',
      sourceId: 'd1',
    });
    await t.owner.db.insert(taches).values([
      {
        instanceId: instance.id,
        titre: 'Tâche fictive',
        canal: 'email',
        source: 'hubspot',
        sourceId: 't1',
      },
      { instanceId: instance.id, titre: 'Tâche OS', canal: 'tache' },
    ]);
  };

  beforeAll(async () => {
    t = await setupTestApp();
    dossier = await mkdtemp(path.join(tmpdir(), 'detachement-'));
    a = await createInstance(t.owner.db, { slug: 'det-a', nom: 'A', type: 'propre' });
    b = await createInstance(t.owner.db, { slug: 'det-b', nom: 'B', type: 'mandat' });
    for (const i of [a, b]) {
      await brancher(i);
      await remplir(i);
    }
  });
  afterAll(async () => {
    await rm(dossier, { recursive: true, force: true });
    await t.drop();
  });

  it('simule sans rien écrire', async () => {
    expect(await run('crm:detacher', '--slug', 'det-a')).toBe(0);
    expect(lignes.join('\n')).toMatch(/entreprises\s+1/);
    expect(lignes.join('\n')).toMatch(/Simulation/);
    expect(await compte(a, 'hubspot')).toBe('3');
    expect(await readdir(dossier)).toHaveLength(0);
  });

  it('refuse une instance sans HubSpot', async () => {
    await createInstance(t.owner.db, { slug: 'det-sans', nom: 'S', type: 'propre' });
    expect(await run('crm:detacher', '--slug', 'det-sans')).toBe(1);
    expect(lignes.join('\n')).toMatch(/pas de CRM HubSpot/);
  });

  it("détache l'instance demandée seulement, garde les identifiants et reprend les étapes", async () => {
    expect(await run('crm:detacher', '--slug', 'det-a', '--appliquer')).toBe(0);
    expect(await compte(a, 'hubspot')).toBe('0');
    expect(await compte(a, 'natif')).toBe('5');
    // L'autre instance garde sa connexion et ses fiches HubSpot.
    expect(await compte(b, 'hubspot')).toBe('3');
    const restantes = await t.owner.db.select().from(connexions);
    expect(restantes.map((c) => c.instanceId)).toEqual([b.id]);

    const sauvegardes = await readdir(dossier);
    expect(sauvegardes).toHaveLength(1);
    const contenu = JSON.parse(
      await readFile(path.join(dossier, sauvegardes[0] ?? ''), 'utf8'),
    ) as { correspondances: Record<string, { sourceId: string }[]> };
    expect(contenu.correspondances.taches?.map((x) => x.sourceId)).toEqual(['t1']);

    const [instance] = await t.owner.db.select().from(instances).where(eq(instances.id, a.id));
    expect(instance?.config.pipeline?.etapes).toHaveLength(3);
  });

  it('garde le pipeline : mêmes étapes, affaires à leur place, pipeline éditable', async () => {
    const instance = (await getInstanceBySlug(t.owner.db, 'det-a'))!;
    const src = await withInstance(t.app.db, instance.id, (tx) => pipelineSource(tx));
    expect(src).toMatchObject({ source: 'natif', ecrit: true });
    expect(src.etapes.map((e) => e.label)).toEqual(['0 - Cible', '1 - Lead']);
    const pipeline = await getPipeline(t.app.db, instance);
    expect(pipeline.opportunites[0]?.etape).toBe('9002');
  });

  it("rend les tâches modifiables dans l'OS, sans écriture simulée", async () => {
    const instance = (await getInstanceBySlug(t.owner.db, 'det-a'))!;
    const { rows } = await t.owner.pool.query<{ id: string }>(
      "select id from taches where instance_id = $1 and titre = 'Tâche fictive'",
      [instance.id],
    );
    const vue = await updateTache(
      t.app.db,
      instance,
      rows[0]?.id ?? '',
      { fait: true },
      { secretsDir: dossier, realWrites: false },
    );
    expect(vue).toMatchObject({ fait: true });
  });

  it('refuse un second détachement', async () => {
    expect(await run('crm:detacher', '--slug', 'det-a', '--appliquer')).toBe(1);
  });
});
