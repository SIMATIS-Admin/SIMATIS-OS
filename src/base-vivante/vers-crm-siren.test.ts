import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import type { EntrepriseAnnuaire } from '../annuaire/client.js';
import { contacts, entreprises } from '../crm/schema.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { enregistrerEntreprise } from './entreprises.js';
import { integrerFiches, majHistorique, rattacherEntreprise } from './integration.js';
import { normaliserFiche, type Brut } from './nettoyage.js';
import { entrerDansCrm } from './vers-crm.js';

const annuaire = (siren: string, nom: string): EntrepriseAnnuaire => ({
  siren,
  nom,
  formeJuridique: null,
  naf: null,
  categorie: null,
  effectif: null,
  creeLe: null,
  active: true,
  etablissementsOuverts: null,
  oppositionDiffusion: false,
  siret: null,
  adresse: null,
  codePostal: null,
  ville: null,
  departement: null,
  latitude: null,
  longitude: null,
  finances: [],
  dirigeants: [],
});

describe('base vivante : entrée dans le CRM par SIREN', () => {
  let t: TestApp;
  let base: Instance;
  let mandat: Instance;
  const deps = { secretsDir: './secrets/instances', realWrites: false };

  beforeAll(async () => {
    t = await setupTestApp();
    base = await createInstance(t.owner.db, { slug: 'bv-s-base', nom: 'Base', type: 'propre' });
    mandat = await createInstance(t.owner.db, {
      slug: 'bv-s-mandat',
      nom: 'Mandat Fictif',
      type: 'mandat',
    });
  });
  afterAll(async () => {
    await t.drop();
  });
  beforeEach(async () => {
    for (const table of [
      'activites',
      'contacts',
      'entreprises',
      'base_vivante',
      'base_entreprises',
    ])
      await t.owner.pool.query(`delete from ${table}`);
  });

  // Une fiche prête à entrer dans le CRM, rattachée ou non à une entreprise de l'annuaire.
  const fiche = async (brut: Brut, siren?: string) => {
    const [r] = await withInstance(t.app.db, base.id, (tx) =>
      integrerFiches(tx, base.id, [
        {
          fiche: normaliserFiche(brut).fiche,
          provenance: 'Sharp',
          mandat: null,
          importId: null,
          collecteLe: null,
        },
      ]),
    );
    const id = r?.id ?? '';
    await withInstance(t.app.db, base.id, async (tx) => {
      await majHistorique(tx, base.id, id, {
        dernierContactLe: new Date('2026-09-12T09:00:00Z'),
        dernierContactCanal: 'email',
        mandatContacteur: 'Mandat Fictif',
        nbContacts: 1,
        resultat: 'repondu',
      });
      if (siren) {
        const e = await enregistrerEntreprise(tx, base.id, annuaire(siren, 'ATELIER FICTIF'));
        await rattacherEntreprise(tx, base.id, id, e.id);
      }
    });
    return id;
  };
  const crm = () => t.owner.db.select().from(entreprises);

  it('crée l’entreprise du CRM avec le SIREN confirmé dans la base', async () => {
    const id = await fiche(
      { entreprise: 'Atelier Fictif', nom: 'Martin', email: 'a@atelier-fictif.test' },
      '123456789',
    );
    expect((await entrerDansCrm(t.app.db, deps, base.id, id)).resultat).toBe('cree');
    expect(await crm()).toMatchObject([{ nom: 'Atelier Fictif', siren: '123456789' }]);
  });

  it('retrouve l’entreprise par son SIREN même si le nom a changé d’une liste à l’autre', async () => {
    const un = await fiche(
      { entreprise: 'Atelier Fictif', nom: 'Martin', email: 'a@atelier-fictif.test' },
      '123456789',
    );
    const deux = await fiche(
      { entreprise: 'Atelier Fictif SAS', nom: 'Durand', email: 'd@autre-domaine.test' },
      '123456789',
    );
    await entrerDansCrm(t.app.db, deps, base.id, un);
    await entrerDansCrm(t.app.db, deps, base.id, deux);
    expect(await crm()).toHaveLength(1);
    const personnes = await t.owner.db.select().from(contacts);
    expect(personnes).toHaveLength(2);
    expect(new Set(personnes.map((c) => c.entrepriseId)).size).toBe(1);
  });

  it('complète le SIREN d’une entreprise du CRM trouvée par son nom, sans le changer ensuite', async () => {
    await t.owner.db.insert(entreprises).values({
      instanceId: mandat.id,
      nom: 'Atelier Fictif',
      domaine: 'atelier-fictif.test',
    });
    const id = await fiche(
      { entreprise: 'Atelier Fictif', nom: 'Martin', email: 'a@atelier-fictif.test' },
      '123456789',
    );
    await entrerDansCrm(t.app.db, deps, base.id, id);
    expect(await crm()).toMatchObject([{ nom: 'Atelier Fictif', siren: '123456789' }]);
  });

  it('ne confond pas deux sociétés de même nom quand leurs SIREN diffèrent', async () => {
    await t.owner.db.insert(entreprises).values({
      instanceId: mandat.id,
      nom: 'Atelier Fictif',
      domaine: 'atelier-fictif.test',
      siren: '987654321',
    });
    const id = await fiche(
      { entreprise: 'Atelier Fictif', nom: 'Martin', email: 'a@atelier-fictif.test' },
      '123456789',
    );
    await entrerDansCrm(t.app.db, deps, base.id, id);
    const lignes = await crm();
    expect(lignes.map((e) => e.siren).sort()).toEqual(['123456789', '987654321']);
    const [c] = await t.owner.db.select().from(contacts);
    expect(lignes.find((e) => e.id === c?.entrepriseId)?.siren).toBe('123456789');
  });

  it('garde le rapprochement par nom ou domaine quand la fiche n’est pas rattachée', async () => {
    await t.owner.db.insert(entreprises).values({
      instanceId: mandat.id,
      nom: 'Atelier Fictif',
      domaine: 'atelier-fictif.test',
    });
    const id = await fiche({
      entreprise: 'Atelier Fictif',
      nom: 'Martin',
      email: 'a@atelier-fictif.test',
    });
    await entrerDansCrm(t.app.db, deps, base.id, id);
    expect(await crm()).toMatchObject([{ nom: 'Atelier Fictif', siren: null }]);
  });
});
