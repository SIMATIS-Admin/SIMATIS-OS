import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { integrerFiches } from './integration.js';
import { normaliserFiche, type Brut } from './nettoyage.js';
import { prospectionSuiviFroid } from '../prospection/schema.js';
import { etatRadar } from './radar.js';
import { modifierConformite } from './service.js';

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

// Les colonnes du Radar sont lues dans la base vivante : zone et statut de prospection.
describe('Radar : colonnes de la base vivante', () => {
  let t: TestApp;
  let inst: Instance;
  beforeAll(async () => {
    t = await setupTestApp();
    inst = await createInstance(t.owner.db, { slug: 'radar', nom: 'R', type: 'propre' });
  });
  afterAll(async () => {
    await t.drop();
  });

  it('range chaque fiche dans sa colonne, sans compter opposés ni exclus parmi les prêts', async () => {
    const res = await withInstance(t.owner.db, inst.id, async (tx) => {
      const r = await integrer(tx, inst.id, [
        { entreprise: 'Atelier Un', nom: 'Un', email: 'un@exemple.test' },
        { entreprise: 'Atelier Deux', nom: 'Deux', email: 'deux@exemple.test' },
        { entreprise: 'Atelier Trois', nom: 'Trois', email: 'trois@exemple.test' },
        { entreprise: 'Atelier Quatre', nom: 'Quatre', email: 'quatre@exemple.test' },
        { entreprise: 'Atelier Cinq', nom: 'Cinq', email: 'cinq@exemple.test' },
        { entreprise: 'Atelier Six' },
      ]);
      await tx.execute(
        sql`update base_vivante set statut_prospection = 'contacte', nb_contacts = 1 where id = ${r[1]!.id}`,
      );
      await tx.execute(
        sql`update base_vivante set statut_prospection = 'a_repondu' where id = ${r[2]!.id}`,
      );
      return r;
    });
    await modifierConformite(t.owner.db, inst.id, res[3]!.id, { opposition: true });
    await modifierConformite(t.owner.db, inst.id, res[4]!.id, { exclusion: 'concurrent' });

    const radar = await etatRadar(t.app.db, inst.id);
    expect(radar.aEnrichir.total).toBe(1);
    expect(radar.aEnrichir.fiches.map((f) => f.entreprise)).toEqual(['Atelier Six']);
    expect(radar.prets.total).toBe(1);
    expect(radar.prets.fiches.map((f) => f.entreprise)).toEqual(['Atelier Un']);
    expect(radar.contactes.total).toBe(1);
    expect(radar.contactes.fiches[0]?.entreprise).toBe('Atelier Deux');
    expect(radar.ontRepondu.total).toBe(1);
    expect(radar.ontRepondu.fiches[0]?.entreprise).toBe('Atelier Trois');
  });

  it('compte comme contactée une fiche qui a reçu une touche de prospection à froid, même sans statut', async () => {
    const autre = await createInstance(t.owner.db, {
      slug: 'radar-froid',
      nom: 'F',
      type: 'propre',
    });
    const ids = await withInstance(t.owner.db, autre.id, async (tx) => {
      const r = await integrer(tx, autre.id, [
        { entreprise: 'Jamais Touchée', nom: 'Neuve', email: 'neuve@exemple.test' },
        { entreprise: 'Déjà Touchée', nom: 'Touchee', email: 'touchee@exemple.test' },
        { entreprise: 'Suivi Sans Touche', nom: 'Vide', email: 'vide@exemple.test' },
      ]);
      await tx.insert(prospectionSuiviFroid).values([
        {
          instanceId: autre.id,
          baseId: r[1]!.id,
          touches: 2,
          derniereLe: new Date(Date.now() - 2 * 86_400_000),
        },
        { instanceId: autre.id, baseId: r[2]!.id, touches: 0 },
      ]);
      return r;
    });
    const radar = await etatRadar(t.app.db, autre.id);
    expect(ids).toHaveLength(3);
    expect(radar.contactes.fiches.map((f) => [f.entreprise, f.nbContacts])).toEqual([
      ['Déjà Touchée', 2],
    ]);
    // 2 touches reçues il y a 2 jours, délai de 5 jours après la 2e : prochaine touche dans 3 jours.
    const prochaine = Date.parse(radar.contactes.fiches[0]?.prochaineRelanceLe ?? '');
    expect(Math.round((prochaine - Date.now()) / 86_400_000)).toBe(3);
    expect(radar.prets.fiches.every((f) => f.prochaineRelanceLe === null)).toBe(true);
    expect(radar.prets.fiches.map((f) => f.entreprise).sort()).toEqual([
      'Jamais Touchée',
      'Suivi Sans Touche',
    ]);
  });

  it('ne compte pas « à enrichir » une entreprise dont un contact est déjà joignable', async () => {
    const autre = await createInstance(t.owner.db, { slug: 'radar-enr', nom: 'E', type: 'propre' });
    await withInstance(t.owner.db, autre.id, (tx) =>
      integrer(tx, autre.id, [
        { entreprise: 'Société Complète' },
        { entreprise: 'Société Complète', nom: 'Joignable', email: 'joignable@exemple.test' },
        { entreprise: 'Société Vide' },
      ]),
    );
    const radar = await etatRadar(t.app.db, autre.id);
    expect(radar.aEnrichir.fiches.map((f) => f.entreprise)).toEqual(['Société Vide']);
    expect(radar.aEnrichir.total).toBe(1);
  });

  it('limite les fiches montrées mais compte toutes celles de la colonne', async () => {
    await withInstance(t.owner.db, inst.id, (tx) =>
      integrer(
        tx,
        inst.id,
        Array.from({ length: 8 }, (_, i) => ({
          entreprise: `Fonderie ${i}`,
          nom: `Nom${i}`,
          email: `f${i}@exemple.test`,
        })),
      ),
    );
    const radar = await etatRadar(t.app.db, inst.id, 3);
    expect(radar.prets.total).toBe(9);
    expect(radar.prets.fiches).toHaveLength(3);
  });

  it('ne mélange pas les espaces', async () => {
    const autre = await createInstance(t.owner.db, { slug: 'radar-b', nom: 'B', type: 'propre' });
    const radar = await etatRadar(t.app.db, autre.id);
    expect(radar.prets.total).toBe(0);
    expect(radar.aEnrichir.total).toBe(0);
  });
});
