import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { contacts } from '../crm/schema.js';
import { withInstance } from '../db/context.js';
import { createInstance } from '../instances/service.js';
import { integrerFiches } from './integration.js';
import { normaliserFiche, type Brut } from './nettoyage.js';
import { modifierConformite } from './service.js';
import { listerSuspectsHorsCrm } from './suspects.js';

// Les fiches se créent par integration.ts, seul point d'écriture de la base vivante.
const integrer = (tx: Parameters<typeof integrerFiches>[0], instanceId: string, brutes: Brut[]) =>
  integrerFiches(
    tx,
    instanceId,
    brutes.map((b) => ({
      fiche: normaliserFiche(b).fiche,
      provenance: 'import',
      mandat: null,
      importId: null,
      collecteLe: null,
    })),
  );

describe('suspects de la base vivante, hors CRM', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await setupTestApp();
  });
  afterAll(async () => {
    await t.drop();
  });

  it("liste les fiches nommées, exploitables, qui ne sont pas déjà un contact de l'instance", async () => {
    const inst = await createInstance(t.owner.db, { slug: 'suspects', nom: 'S', type: 'propre' });
    const autre = await createInstance(t.owner.db, { slug: 'autre', nom: 'A', type: 'mandat' });
    const ids = await withInstance(t.owner.db, inst.id, async (tx) => {
      const res = await integrer(tx, inst.id, [
        {
          entreprise: 'Société Fictive',
          prenom: 'Alice',
          nom: 'Libre',
          fonction: 'Directrice',
          email: 'alice@exemple.test',
        },
        { entreprise: 'Société Fictive', nom: 'Opposé', email: 'oppose@exemple.test' },
        { entreprise: 'Société Fictive', nom: 'Exclue', email: 'exclue@exemple.test' },
        { entreprise: 'Société Fictive', nom: 'Déjà Contact', email: 'deja@exemple.test' },
        { entreprise: 'Société Fictive', nom: 'Autre Crm', email: 'autrecrm@exemple.test' },
        { entreprise: 'Entreprise sans personne' },
      ]);
      return {
        oppose: res[1]!.id,
        exclue: res[2]!.id,
        dejaContact: res[3]!.id,
        autreCrm: res[4]!.id,
      };
    });
    await modifierConformite(t.owner.db, inst.id, ids.oppose, { opposition: true });
    await modifierConformite(t.owner.db, inst.id, ids.exclue, { exclusion: 'concurrent' });
    await withInstance(t.owner.db, inst.id, async (tx) => {
      const [dansLeCrm] = await tx
        .insert(contacts)
        .values({ instanceId: inst.id, nom: 'Déjà Contact' })
        .returning();
      // Fiche entrée dans le CRM de cette instance, puis une autre dans le CRM d'un autre mandat.
      await tx.execute(
        sql`update base_vivante set crm_contact_id = ${dansLeCrm!.id}, crm_mandat = 'suspects'
          where id = ${ids.dejaContact}`,
      );
      await tx.execute(
        sql`update base_vivante set crm_contact_id = ${crypto.randomUUID()}, crm_mandat = 'autre'
          where id = ${ids.autreCrm}`,
      );
    });
    await withInstance(t.owner.db, autre.id, (tx) =>
      integrer(tx, autre.id, [
        { entreprise: 'Autre', nom: 'Ailleurs', email: 'ailleurs@exemple.test' },
      ]),
    );

    const lignes = await listerSuspectsHorsCrm(t.app.db, inst.id);
    expect(lignes.map((l) => l.nom).sort()).toEqual(['AUTRE CRM', 'Alice LIBRE']);
    expect(lignes.find((l) => l.nom === 'Alice LIBRE')).toMatchObject({
      entreprise: 'Société Fictive',
      fonction: 'Directrice',
      email: 'alice@exemple.test',
    });
    expect((await listerSuspectsHorsCrm(t.app.db, inst.id, 'alice')).map((l) => l.nom)).toEqual([
      'Alice LIBRE',
    ]);
    expect(await listerSuspectsHorsCrm(t.app.db, inst.id, 'introuvable')).toEqual([]);
  });
});
