import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insererFiche } from '../../test/fiche-base.js';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { withInstance } from '../db/context.js';
import { createInstance } from '../instances/service.js';
import { echantillonFroid } from './froid.js';
import { prospectionSuiviFroid } from './schema.js';
import {
  cumul,
  DELAIS_DEFAUT,
  delaiApres,
  lireSequence,
  prochaineTouche,
  sauverSequence,
} from './sequence.js';

describe('Séquence à froid : les délais entre touches', () => {
  it('par défaut J+4, J+9 puis J+15 depuis le premier mail', () => {
    expect(DELAIS_DEFAUT).toEqual([4, 5, 6]);
    expect(cumul(DELAIS_DEFAUT)).toEqual([4, 9, 15]);
  });

  it('attend le délai de la touche reçue, le dernier valant pour les suivantes', () => {
    expect(delaiApres(1, [4, 5, 6])).toBe(4);
    expect(delaiApres(2, [4, 5, 6])).toBe(5);
    expect(delaiApres(3, [4, 5, 6])).toBe(6);
    expect(delaiApres(7, [4, 5, 6])).toBe(6);
    expect(delaiApres(0, [4, 5, 6])).toBe(4);
  });

  it("calcule la date de la prochaine touche, et rien quand il n'y en a plus", () => {
    const derniereLe = new Date('2026-11-02T08:00:00Z');
    expect(prochaineTouche({ touches: 1, touchesMax: 4, derniereLe }, [4, 5, 6])).toEqual(
      new Date('2026-11-06T08:00:00Z'),
    );
    expect(prochaineTouche({ touches: 2, touchesMax: 4, derniereLe }, [4, 5, 6])).toEqual(
      new Date('2026-11-07T08:00:00Z'),
    );
    expect(prochaineTouche({ touches: 4, touchesMax: 4, derniereLe }, [4, 5, 6])).toBeNull();
    expect(prochaineTouche({ touches: 0, touchesMax: 4, derniereLe: null }, [4, 5, 6])).toBeNull();
  });
});

describe('Séquence à froid : réglage et éligibilité', () => {
  let t: TestApp;
  let a: string;
  let b: string;
  beforeAll(async () => {
    t = await setupTestApp();
    a = (await createInstance(t.owner.db, { slug: 'seq-a', nom: 'A', type: 'mandat' })).id;
    b = (await createInstance(t.owner.db, { slug: 'seq-b', nom: 'B', type: 'mandat' })).id;
  });
  afterAll(async () => {
    await t.drop();
  });

  let n = 0;
  const fiche = async (touches: number, joursDepuis: number): Promise<string> => {
    n += 1;
    const id = await insererFiche(t.owner.db, {
      instanceId: a,
      zone: 'prospectable',
      entreprise: `Atelier Fictif ${n}`,
      prenom: 'Camille',
      nom: `Dupré${n}`,
      email: `seq${n}@fictif.test`,
      provenance: 'Salon fictif',
    });
    await t.owner.db.insert(prospectionSuiviFroid).values({
      instanceId: a,
      baseId: id,
      touches,
      touchesMax: 4,
      derniereLe: new Date(Date.now() - joursDepuis * 86_400_000),
    });
    return id;
  };
  const eligibles = async () =>
    (await withInstance(t.app.db, a, (tx) => echantillonFroid(tx, { nombre: 500 }))).map(
      (c) => c.id,
    );

  it('lit les délais par défaut, puis ceux enregistrés pour cet espace seulement', async () => {
    expect(await lireSequence(t.app.db, a)).toEqual({ delais: DELAIS_DEFAUT });
    await sauverSequence(t.app.db, a, { delais: [10, 20] });
    expect(await lireSequence(t.app.db, a)).toEqual({ delais: [10, 20] });
    expect(await lireSequence(t.app.db, b)).toEqual({ delais: DELAIS_DEFAUT });
    await expect(sauverSequence(t.app.db, a, { delais: [] })).rejects.toThrow();
    await expect(sauverSequence(t.app.db, a, { delais: [0] })).rejects.toThrow();
    await sauverSequence(t.app.db, a, { delais: DELAIS_DEFAUT });
  });

  it('propose la touche suivante quand le délai de la touche reçue est écoulé', async () => {
    const premiere = await fiche(1, 5); // 1re touche il y a 5 jours, délai 4 : prête
    const tropTot = await fiche(1, 3); // délai 4 : pas encore
    const deuxieme = await fiche(2, 5); // 2e touche il y a 5 jours, délai 5 : prête
    const deuxiemeTot = await fiche(2, 4); // délai 5 : pas encore
    const ids = await eligibles();
    expect(ids).toContain(premiere);
    expect(ids).not.toContain(tropTot);
    expect(ids).toContain(deuxieme);
    expect(ids).not.toContain(deuxiemeTot);
  });

  it('suit les délais réglés par le pilote', async () => {
    await sauverSequence(t.app.db, a, { delais: [10, 20] });
    const cinqJours = await fiche(1, 5);
    const douzeJours = await fiche(1, 12);
    const deuxiemeQuinze = await fiche(2, 15);
    const deuxiemeVingtCinq = await fiche(2, 25);
    const ids = await eligibles();
    expect(ids).not.toContain(cinqJours);
    expect(ids).toContain(douzeJours);
    expect(ids).not.toContain(deuxiemeQuinze);
    expect(ids).toContain(deuxiemeVingtCinq);
    await sauverSequence(t.app.db, a, { delais: DELAIS_DEFAUT });
  });
});
