import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { entreprises } from '../crm/schema.js';
import type { Instance } from '../instances/schema.js';
import { createInstance, setModule } from '../instances/service.js';
import {
  AtelierIndisponible,
  AtelierIntrouvable,
  atelierActif,
  createAtelier,
  deleteAtelier,
  EntrepriseIntrouvable,
  getAtelier,
  listAteliers,
  updateAtelier,
} from './service.js';

describe('Atelier stratégique : service', () => {
  let t: TestApp;
  let simatis: Instance;
  let sansModule: Instance;
  let autre: Instance;
  let mandat: Instance;
  let entrepriseId: string;
  let entrepriseAutre: string;

  beforeAll(async () => {
    t = await setupTestApp();
    const base = await createInstance(t.owner.db, { slug: 'atl-a', nom: 'A', type: 'propre' });
    simatis = await setModule(t.owner.db, 'atl-a', 'atelier', true);
    sansModule = await createInstance(t.owner.db, { slug: 'atl-b', nom: 'B', type: 'propre' });
    const second = await createInstance(t.owner.db, { slug: 'atl-c', nom: 'C', type: 'propre' });
    autre = await setModule(t.owner.db, 'atl-c', 'atelier', true);
    mandat = await createInstance(t.owner.db, { slug: 'atl-m', nom: 'M', type: 'mandat' });
    expect(base.id).toBe(simatis.id);
    expect(second.id).toBe(autre.id);
    const [e] = await t.owner.db
      .insert(entreprises)
      .values({ instanceId: simatis.id, nom: 'Entreprise Fictive A' })
      .returning({ id: entreprises.id });
    entrepriseId = e!.id;
    const [f] = await t.owner.db
      .insert(entreprises)
      .values({ instanceId: autre.id, nom: 'Entreprise Fictive B' })
      .returning({ id: entreprises.id });
    entrepriseAutre = f!.id;
  });

  afterAll(async () => {
    await t.drop();
  });

  it('refuse une instance sans le module atelier, mandat compris', async () => {
    expect(atelierActif(simatis)).toBe(true);
    expect(atelierActif(sansModule)).toBe(false);
    await expect(listAteliers(t.app.db, sansModule)).rejects.toBeInstanceOf(AtelierIndisponible);
    await expect(listAteliers(t.app.db, mandat)).rejects.toBeInstanceOf(AtelierIndisponible);
  });

  it("crée un atelier à l'étape 1 rattaché à l'entreprise", async () => {
    const a = await createAtelier(t.app.db, simatis, {
      entrepriseId,
      titre: '  Lancement fictif ',
    });
    expect(a).toMatchObject({ titre: 'Lancement fictif', entrepriseId, etape: 1, etapeMax: 1 });
    expect(a.etat).toMatchObject({ v: 1, step: 0 });
  });

  it("refuse une entreprise d'une autre instance", async () => {
    await expect(
      createAtelier(t.app.db, simatis, { entrepriseId: entrepriseAutre, titre: 'X' }),
    ).rejects.toBeInstanceOf(EntrepriseIntrouvable);
  });

  it("enregistre l'étape et garde l'étape max quand on revient en arrière", async () => {
    const a = await createAtelier(t.app.db, simatis, { entrepriseId, titre: 'Retour fictif' });
    await updateAtelier(t.app.db, simatis, a.id, { etat: { v: 1, step: 3 } });
    const revenu = await updateAtelier(t.app.db, simatis, a.id, { etat: { v: 1, step: 1 } });
    expect(revenu).toMatchObject({ etape: 2, etapeMax: 4 });
  });

  it("la liste ne renvoie pas l'état", async () => {
    const liste = await listAteliers(t.app.db, simatis);
    expect(liste.length).toBeGreaterThan(0);
    for (const l of liste) expect(l).not.toHaveProperty('etat');
  });

  it("une autre instance ne voit pas l'atelier", async () => {
    const a = await createAtelier(t.app.db, simatis, { entrepriseId, titre: 'Privé fictif' });
    expect((await listAteliers(t.app.db, autre)).map((l) => l.id)).not.toContain(a.id);
    await expect(getAtelier(t.app.db, autre, a.id)).rejects.toBeInstanceOf(AtelierIntrouvable);
  });

  it('supprime un atelier', async () => {
    const a = await createAtelier(t.app.db, simatis, { entrepriseId, titre: 'À supprimer' });
    await deleteAtelier(t.app.db, simatis, a.id);
    await expect(getAtelier(t.app.db, simatis, a.id)).rejects.toBeInstanceOf(AtelierIntrouvable);
  });
});
