import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { cleDejaDansUnAutreEspace } from './cle-unique.js';
import { deposerSujet } from './depot.js';

describe('Inbox : une clé, une seule entrée pour le pilote', () => {
  let t: TestApp;
  let perso: Instance;
  let mandat: Instance;
  let autreMandat: Instance;
  let demo: Instance;

  const deposer = (i: Instance, cle: string) =>
    withInstance(t.app.db, i.id, (tx) =>
      deposerSujet(tx, {
        type: 'compte_rendu',
        titre: `Sujet ${cle}`,
        origine: 'agenda',
        source: 'routine',
        sourceId: cle,
      }),
    );

  beforeAll(async () => {
    t = await setupTestApp();
    perso = await createInstance(t.owner.db, { slug: 'cle-perso', nom: 'P', type: 'propre' });
    mandat = await createInstance(t.owner.db, { slug: 'cle-mandat', nom: 'M', type: 'mandat' });
    autreMandat = await createInstance(t.owner.db, {
      slug: 'cle-mandat-2',
      nom: 'N',
      type: 'mandat',
    });
    demo = await createInstance(t.owner.db, { slug: 'cle-demo', nom: 'D', type: 'prospect' });
    await deposer(mandat, 'agenda:evt-1');
  });
  afterAll(async () => {
    await t.drop();
  });

  const vu = (i: Instance, cle: string) => cleDejaDansUnAutreEspace(t.app.db, i, 'routine', cle);

  it('voit un sujet déjà déposé dans un autre mandat, et depuis Mon activité', async () => {
    expect(await vu(perso, 'agenda:evt-1')).toBe(true);
    expect(await vu(autreMandat, 'agenda:evt-1')).toBe(true);
  });

  it('ne compte pas l’espace lui-même : il a sa propre règle « existant »', async () => {
    expect(await vu(mandat, 'agenda:evt-1')).toBe(false);
  });

  it('ne voit rien pour une clé inconnue, ni pour une autre source', async () => {
    expect(await vu(perso, 'agenda:evt-2')).toBe(false);
    expect(await cleDejaDansUnAutreEspace(t.app.db, perso, 'os', 'agenda:evt-1')).toBe(false);
  });

  it('laisse une démo à part, dans les deux sens', async () => {
    expect(await vu(demo, 'agenda:evt-1')).toBe(false);
    await deposer(demo, 'agenda:evt-demo');
    expect(await vu(perso, 'agenda:evt-demo')).toBe(false);
  });
});
