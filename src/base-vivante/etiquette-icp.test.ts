import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import type { ClientAnnuaire, EntrepriseAnnuaire } from '../annuaire/client.js';
import { createInstance } from '../instances/service.js';
import { registerBaseVivanteRoutes } from './routes.js';
import { etatRadar } from './radar.js';

const annuaire = (siren: string, nom: string): EntrepriseAnnuaire => ({
  siren,
  nom,
  formeJuridique: null,
  naf: '25.62B',
  categorie: 'PME',
  effectif: '20 à 49 salariés',
  creeLe: null,
  active: true,
  etablissementsOuverts: null,
  oppositionDiffusion: false,
  siret: null,
  adresse: null,
  codePostal: null,
  ville: 'CHASSIEU',
  departement: '69',
  latitude: null,
  longitude: null,
  finances: [],
  dirigeants: [],
});

// L'ICP d'où vient une entreprise est gardé en étiquette, pour savoir à quelle cible elle répond.
describe('Étiquette ICP à l’ajout d’entreprises', () => {
  let t: TestApp;
  const client = {
    chercher: vi.fn<ClientAnnuaire['chercher']>(),
    parSiren: vi.fn<ClientAnnuaire['parSiren']>((s) =>
      Promise.resolve(annuaire(s, s === '111111111' ? 'ATELIER FICTIF' : 'USINE FICTIVE')),
    ),
    rechercher: vi.fn<ClientAnnuaire['rechercher']>(),
  };
  beforeAll(async () => {
    t = await setupTestApp();
    await createInstance(t.owner.db, { slug: 'etq', nom: 'E', type: 'propre' });
  });
  afterAll(async () => {
    await t.drop();
  });
  const ajouter = (payload: Record<string, unknown>) => {
    const a = Fastify();
    registerBaseVivanteRoutes(a, { db: t.app.db, annuaire: client });
    return a.inject({ method: 'POST', url: '/api/i/etq/base/entreprises/ajouter', payload });
  };
  const tags = async () =>
    (
      await t.owner.pool.query<{ entreprise: string; tags: string[] }>(
        'select entreprise, tags from base_vivante order by entreprise',
      )
    ).rows;

  it("pose l'étiquette, normalisée, sur chaque entreprise ajoutée", async () => {
    const r = await ajouter({
      sirens: ['111111111', '222222222'],
      etiquette: '  ICP A (Simatis) ',
    });
    expect(r.statusCode).toBe(200);
    expect(await tags()).toEqual([
      { entreprise: 'ATELIER FICTIF', tags: ['icp a (simatis)'] },
      { entreprise: 'USINE FICTIVE', tags: ['icp a (simatis)'] },
    ]);
  });

  it('garde les étiquettes déjà posées quand une entreprise connue est rattachée à un autre ICP', async () => {
    await ajouter({ sirens: ['111111111'], etiquette: 'icp b' });
    const atelier = (await tags()).find((x) => x.entreprise === 'ATELIER FICTIF');
    expect(atelier?.tags).toEqual(['icp a (simatis)', 'icp b']);
  });

  it("n'ajoute aucune étiquette sans demande, et refuse une étiquette trop longue", async () => {
    await ajouter({ sirens: ['333333333'] });
    expect((await tags()).find((x) => x.entreprise === 'USINE FICTIVE')?.tags).toEqual([
      'icp a (simatis)',
    ]);
    const trop = await ajouter({ sirens: ['333333333'], etiquette: 'x'.repeat(80) });
    expect(trop.statusCode).toBe(400);
  });

  it("le Radar montre l'étiquette sur la fiche", async () => {
    const [inst] = (
      await t.owner.pool.query<{ id: string }>("select id from instances where slug = 'etq'")
    ).rows;
    const radar = await etatRadar(t.app.db, inst!.id);
    expect(radar.aEnrichir.fiches.find((f) => f.entreprise === 'ATELIER FICTIF')?.tags).toEqual([
      'icp a (simatis)',
      'icp b',
    ]);
  });
});
