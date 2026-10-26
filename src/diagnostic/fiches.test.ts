import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { getFiche } from '../crm/fiches.js';
import { fusionnerFiches } from '../crm/fusion.js';
import { supprimerFiche } from '../crm/suppression.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { createProjet } from './service.js';

describe('Diagnostics dans les fiches', () => {
  let t: TestApp;
  let simatis: Instance;
  let mandat: Instance;
  const deps = { secretsDir: '/nonexistent', realWrites: false };

  const ligne = async (i: Instance, table: string, nom: string) =>
    (
      await t.owner.pool.query<{ id: string }>(
        `insert into ${table} (instance_id, nom) values ($1, $2) returning id`,
        [i.id, nom],
      )
    ).rows[0]!.id;
  const projetDe = async (id: string) =>
    (
      await t.owner.pool.query<{ entreprise_id: string | null; contact_id: string | null }>(
        'select entreprise_id, contact_id from diagnostic_projets where id = $1',
        [id],
      )
    ).rows[0]!;

  beforeAll(async () => {
    t = await setupTestApp();
    simatis = await createInstance(t.owner.db, {
      slug: 'diag-fiches',
      nom: 'SIMATIS',
      type: 'propre',
    });
    mandat = await createInstance(t.owner.db, {
      slug: 'diag-fiches-m',
      nom: 'Mandat',
      type: 'mandat',
    });
  });
  afterAll(() => t.drop());

  it('l’organisation et le contact montrent leurs diagnostics', async () => {
    const entrepriseId = await ligne(simatis, 'entreprises', 'Atelier Fictif');
    const contactId = await ligne(simatis, 'contacts', 'Dirigeant Fictif');
    const p = await createProjet(t.app.db, simatis, {
      nom: 'Atelier Fictif',
      activite: 'usinage',
      entrepriseId,
      contactId,
    });
    for (const [kind, id] of [
      ['entreprise', entrepriseId],
      ['contact', contactId],
    ] as const) {
      const f = await getFiche(t.app.db, simatis, kind, id);
      expect(f?.diagnostics).toEqual([
        { id: p.id, nom: 'Atelier Fictif', etape: 1, statut: null, date: null },
      ]);
    }
  });

  it('une fiche sans diagnostic en montre une liste vide, un mandat n’en montre pas', async () => {
    const seule = await ligne(simatis, 'entreprises', 'Sans Diagnostic');
    expect((await getFiche(t.app.db, simatis, 'entreprise', seule))?.diagnostics).toEqual([]);
    const chezMandat = await ligne(mandat, 'entreprises', 'Chez Mandat');
    expect(
      (await getFiche(t.app.db, mandat, 'entreprise', chezMandat))?.diagnostics,
    ).toBeUndefined();
  });

  it('la fusion déplace le diagnostic vers la fiche gardée, la suppression le détache', async () => {
    const garde = await ligne(simatis, 'contacts', 'Contact Gardé');
    const absorbe = await ligne(simatis, 'contacts', 'Contact Absorbé');
    const orgaGardee = await ligne(simatis, 'entreprises', 'Organisation Gardée');
    const orgaAbsorbee = await ligne(simatis, 'entreprises', 'Organisation Absorbée');
    const p = await createProjet(t.app.db, simatis, {
      nom: 'À fusionner',
      activite: 'usinage',
      entrepriseId: orgaAbsorbee,
      contactId: absorbe,
    });
    await fusionnerFiches(t.app.db, simatis, 'contact', garde, absorbe, deps);
    await fusionnerFiches(t.app.db, simatis, 'entreprise', orgaGardee, orgaAbsorbee, deps);
    expect(await projetDe(p.id)).toEqual({ entreprise_id: orgaGardee, contact_id: garde });

    await supprimerFiche(t.app.db, simatis, { kind: 'contact', id: garde }, deps);
    await supprimerFiche(t.app.db, simatis, { kind: 'entreprise', id: orgaGardee }, deps);
    expect(await projetDe(p.id)).toEqual({ entreprise_id: null, contact_id: null });
  });
});
