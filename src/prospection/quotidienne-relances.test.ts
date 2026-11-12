import { eq } from 'drizzle-orm';
import { expect, it, vi } from 'vitest';
import { setupTestApp } from '../../test/database.js';
import { insererFiche } from '../../test/fiche-base.js';
import { withInstance } from '../db/context.js';
import { createInstance } from '../instances/service.js';
import { reglageParDefaut } from './campagnes.js';
import {
  lireRoutineBrouillons,
  RELANCES_PAR_JOUR,
  sauverRoutineBrouillons,
  tournerBrouillons,
} from './quotidienne.js';
import { prospectionBrouillons, prospectionCampagnes, prospectionSuiviFroid } from './schema.js';

const jours = (n: number) => new Date(Date.now() - n * 86_400_000);

it('prépare aussi les relances dont le délai est écoulé, avec créneaux, sans doublon ni dépassement', async () => {
  const t = await setupTestApp();
  try {
    const instance = await createInstance(t.owner.db, {
      slug: 'relances-test',
      nom: 'Test',
      type: 'propre',
    });
    let n = 0;
    const contact = async (touches: number, joursDepuis: number, plafond = 4) => {
      n += 1;
      const id = await insererFiche(t.owner.db, {
        instanceId: instance.id,
        entreprise: `Atelier Fictif ${n}`,
        nom: `Dupré${n}`,
        email: `relance${n}@atelier.test`,
        provenance: 'Test',
        zone: 'prospectable',
      });
      if (touches > 0)
        await t.owner.db.insert(prospectionSuiviFroid).values({
          instanceId: instance.id,
          baseId: id,
          touches,
          touchesMax: plafond,
          derniereLe: jours(joursDepuis),
        });
      return id;
    };
    const deuxiemeTouche = await contact(1, 6); // délai de 4 jours écoulé : relance 2
    const troisiemeTouche = await contact(2, 6); // délai de 5 jours écoulé : relance 3
    const tropTot = await contact(1, 2); // pas encore
    const auPlafond = await contact(4, 30); // plafond atteint
    const neuf = await contact(0, 0); // premier mail, pas une relance
    // Un lien VMA déjà donné à ce contact lors de sa première touche : il est repris tel quel.
    await withInstance(t.owner.db, instance.id, async (tx) => {
      const [c] = await tx
        .insert(prospectionCampagnes)
        .values({
          instanceId: instance.id,
          mode: 'froid',
          reglage: reglageParDefaut(),
          statut: 'terminee',
        })
        .returning();
      await tx.insert(prospectionBrouillons).values({
        instanceId: instance.id,
        campagneId: c!.id,
        baseId: deuxiemeTouche,
        contactNom: 'Dupré1',
        contactEmail: 'relance1@atelier.test',
        societe: 'Atelier Fictif 1',
        touche: 1,
        lienVma: 'https://site.test/ancien-lien',
      });
    });
    await sauverRoutineBrouillons(t.app.db, instance.id, { active: true, heure: '10:00' });
    const http = vi.fn(() =>
      Promise.resolve(
        Response.json({
          id: http.mock.calls.length.toString().padStart(32, '0'),
          expireLe: '2027-01-01T00:00:00Z',
        }),
      ),
    );
    const deps = { url: 'https://site.test', token: 'fictif', fetch: http as typeof fetch };
    await tournerBrouillons(t.app.db, deps, new Date('2026-11-04T09:00:00Z'));
    await tournerBrouillons(t.app.db, deps, new Date('2026-11-04T15:00:00Z'));

    const brouillons = await withInstance(t.app.db, instance.id, (tx) =>
      tx.select().from(prospectionBrouillons).where(eq(prospectionBrouillons.etat, 'a_rediger')),
    );
    // Les brouillons préparés ce jour-là seulement : l'ancien, d'une campagne terminée, n'a pas de consigne.
    const de = (baseId: string) =>
      brouillons.filter((b) => b.baseId === baseId && b.consigne !== null);
    expect(de(deuxiemeTouche)).toHaveLength(1);
    expect(de(deuxiemeTouche)[0]).toMatchObject({
      touche: 2,
      lienVma: 'https://site.test/ancien-lien',
    });
    expect(de(deuxiemeTouche)[0]?.consigne).toContain('relance');
    expect(de(troisiemeTouche)[0]?.touche).toBe(3);
    expect(de(tropTot)).toHaveLength(0);
    expect(de(auPlafond)).toHaveLength(0);
    // Le contact neuf reçoit son premier mail par la voie habituelle, avec un lien neuf.
    expect(de(neuf)[0]).toMatchObject({ touche: 1 });
    expect(de(neuf)[0]?.consigne).toContain('premier contact');
    // Les relances demandent des créneaux ; le lot du premier mail, non.
    const campagnes = await withInstance(t.app.db, instance.id, (tx) =>
      tx.select().from(prospectionCampagnes),
    );
    const campagneDe = (b: { campagneId: string }) =>
      campagnes.find((c) => c.id === b.campagneId)?.reglage.creneaux;
    expect(campagneDe(de(deuxiemeTouche)[0]!)).toBe(true);
    expect(campagneDe(de(neuf)[0]!)).toBe(false);
    // Un seul passage par jour : pas de second brouillon pour le même contact.
    expect(de(deuxiemeTouche)).toHaveLength(1);
    expect((await lireRoutineBrouillons(t.app.db, instance.id)).bilan).toContain('2 relance');
  } finally {
    await t.drop();
  }
});

it('ne prépare pas plus de relances par jour que le plafond', async () => {
  const t = await setupTestApp();
  try {
    const instance = await createInstance(t.owner.db, {
      slug: 'relances-plafond',
      nom: 'Test',
      type: 'propre',
    });
    for (let i = 0; i < RELANCES_PAR_JOUR + 5; i += 1) {
      const id = await insererFiche(t.owner.db, {
        instanceId: instance.id,
        entreprise: `Atelier Fictif ${i}`,
        nom: `Martin${i}`,
        email: `plafond${i}@atelier.test`,
        provenance: 'Test',
        zone: 'prospectable',
      });
      await t.owner.db.insert(prospectionSuiviFroid).values({
        instanceId: instance.id,
        baseId: id,
        touches: 1,
        touchesMax: 4,
        derniereLe: jours(10),
      });
    }
    await sauverRoutineBrouillons(t.app.db, instance.id, { active: true, heure: '10:00' });
    const deps = {
      url: 'https://site.test',
      token: 'fictif',
      fetch: (() =>
        Promise.resolve(
          Response.json({ id: '0'.repeat(32), expireLe: '2027-01-01T00:00:00Z' }),
        )) as typeof fetch,
    };
    await tournerBrouillons(t.app.db, deps, new Date('2026-11-04T09:00:00Z'));
    const n = await withInstance(
      t.app.db,
      instance.id,
      async (tx) => (await tx.select().from(prospectionBrouillons)).length,
    );
    expect(n).toBe(RELANCES_PAR_JOUR);
  } finally {
    await t.drop();
  }
});
