import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { entreprises } from '../crm/schema.js';
import { diagnosticProjets } from '../diagnostic/schema.js';
import { getInstanceBySlug } from '../instances/service.js';
import { runCommand } from './cli.js';

describe('diagnostic:rattacher', () => {
  let t: TestApp;
  let lines: string[];

  const run = async (...argv: string[]) => {
    lines = [];
    return runCommand(argv, { db: t.owner.db, out: (line) => lines.push(line) });
  };
  const liensDe = async (nom: string) =>
    (
      await t.owner.pool.query<{ entreprise_id: string | null }>(
        'select entreprise_id from diagnostic_projets where nom = $1',
        [nom],
      )
    ).rows[0]?.entreprise_id ?? null;

  beforeAll(async () => {
    t = await setupTestApp();
    expect(await run('instance:create', '--slug', 'rat', '--nom', 'Rat', '--type', 'propre')).toBe(
      0,
    );
    const instance = (await getInstanceBySlug(t.owner.db, 'rat'))!;
    await t.owner.db
      .insert(entreprises)
      .values({ instanceId: instance.id, nom: 'Entreprise Fictive A' });
    await t.owner.db.insert(diagnosticProjets).values([
      { instanceId: instance.id, nom: 'entreprise fictive a', activite: 'Conseil' },
      { instanceId: instance.id, nom: 'Projet sans correspondance', activite: 'Conseil' },
    ]);
  });

  afterAll(async () => {
    await t.drop();
  });

  it('simule sans rien écrire', async () => {
    expect(await run('diagnostic:rattacher', '--slug', 'rat')).toBe(0);
    expect(lines.join('\n')).toMatch(/exact/);
    expect(await liensDe('entreprise fictive a')).toBeNull();
  });

  it('avec --appliquer, rattache seulement les correspondances exactes', async () => {
    expect(await run('diagnostic:rattacher', '--slug', 'rat', '--appliquer')).toBe(0);
    expect(await liensDe('entreprise fictive a')).not.toBeNull();
    expect(await liensDe('Projet sans correspondance')).toBeNull();
  });
});
