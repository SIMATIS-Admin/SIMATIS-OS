import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { entreprises } from '../crm/schema.js';
import type { Instance } from '../instances/schema.js';
import { createInstance, setModule } from '../instances/service.js';
import { composerDemande, lireCiblages } from './ciblage.js';
import { AtelierIndisponible, createAtelier } from './service.js';

const sept = (...premiers: string[]) => [...premiers, ...Array<string>(7).fill('')].slice(0, 7);

describe('Atelier : ICP et personas lus pour la prospection', () => {
  let t: TestApp;
  let inst: Instance;
  let autre: Instance;
  let mandat: Instance;
  let entrepriseId: string;

  beforeAll(async () => {
    t = await setupTestApp();
    await createInstance(t.owner.db, { slug: 'cib-a', nom: 'A', type: 'propre' });
    inst = await setModule(t.owner.db, 'cib-a', 'atelier', true);
    await createInstance(t.owner.db, { slug: 'cib-b', nom: 'B', type: 'propre' });
    autre = await setModule(t.owner.db, 'cib-b', 'atelier', true);
    mandat = await createInstance(t.owner.db, { slug: 'cib-m', nom: 'M', type: 'mandat' });
    const [e] = await t.owner.db
      .insert(entreprises)
      .values({ instanceId: inst.id, nom: 'Entreprise Fictive' })
      .returning({ id: entreprises.id });
    entrepriseId = e!.id;
    const [f] = await t.owner.db
      .insert(entreprises)
      .values({ instanceId: autre.id, nom: 'Autre Fictive' })
      .returning({ id: entreprises.id });
    await createAtelier(t.app.db, autre, {
      entrepriseId: f!.id,
      titre: 'Atelier d’un autre espace',
      etat: {
        v: 1,
        step: 5,
        icps: [{ code: 'ICP X', name: 'Ne doit pas fuiter', icp: sept('Secret'), persona: sept() }],
      },
    });
  });
  afterAll(async () => {
    await t.drop();
  });

  it('liste les ICP renseignés avec leur persona, champs nommés, et ignore les ICP vides', async () => {
    await createAtelier(t.app.db, inst, {
      entrepriseId,
      titre: 'Atelier fictif',
      etat: {
        v: 1,
        step: 5,
        icps: [
          {
            code: 'ICP A',
            name: 'PME industrielles',
            offer: 'Direction commerciale partagée',
            icp: sept('PME industrielles de 20 à 100 salariés', 'Auvergne-Rhône-Alpes'),
            persona: sept('Dirigeant', 'Faire croître le chiffre d’affaires'),
          },
          { code: 'ICP B', name: '', offer: '', icp: sept(), persona: sept('Directeur') },
        ],
      },
    });
    const ciblages = await lireCiblages(t.app.db, inst);
    expect(ciblages).toHaveLength(1);
    expect(ciblages[0]).toMatchObject({
      atelierTitre: 'Atelier fictif',
      entreprise: 'Entreprise Fictive',
      code: 'ICP A',
      nom: 'PME industrielles',
      offre: 'Direction commerciale partagée',
    });
    expect(ciblages[0]?.icp.slice(0, 2)).toEqual([
      { cle: 'Catégorie', valeur: 'PME industrielles de 20 à 100 salariés' },
      { cle: 'Localisation', valeur: 'Auvergne-Rhône-Alpes' },
    ]);
    expect(ciblages[0]?.icp.find((c) => c.cle === 'Contexte')).toBeUndefined();
    expect(ciblages[0]?.persona[0]).toEqual({ cle: 'Poste', valeur: 'Dirigeant' });
  });

  it("ne lit que l'espace demandé et refuse un espace sans atelier", async () => {
    expect((await lireCiblages(t.app.db, inst)).some((c) => c.nom.includes('fuiter'))).toBe(false);
    await expect(lireCiblages(t.app.db, mandat)).rejects.toBeInstanceOf(AtelierIndisponible);
  });

  it('résiste à un état incomplet ou abîmé', async () => {
    const e2 = await t.owner.db
      .insert(entreprises)
      .values({ instanceId: inst.id, nom: 'Seconde Fictive' })
      .returning({ id: entreprises.id });
    await createAtelier(t.app.db, inst, {
      entrepriseId: e2[0]!.id,
      titre: 'Atelier abîmé',
      etat: { v: 1, step: 1, icps: 'pas une liste' } as never,
    });
    await createAtelier(t.app.db, inst, {
      entrepriseId: e2[0]!.id,
      titre: 'Atelier sans ICP',
      etat: { v: 1, step: 1 },
    });
    expect((await lireCiblages(t.app.db, inst)).map((c) => c.code)).toEqual(['ICP A']);
  });

  it('compose la demande de recherche à partir des champs renseignés', async () => {
    const [icp] = await lireCiblages(t.app.db, inst);
    const demande = composerDemande(icp!);
    expect(demande).toContain('PME industrielles de 20 à 100 salariés');
    expect(demande).toContain('Auvergne-Rhône-Alpes');
    expect(demande).toContain('Dirigeant');
    expect(demande).not.toContain('Sensibilité prix');
  });
});
