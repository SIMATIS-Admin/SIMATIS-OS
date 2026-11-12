import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { ETAPES_NATIVES, getPipeline } from './pipeline.js';
import {
  contacts,
  entreprises,
  opportunites,
  rdvAffaires,
  rdvContacts,
  rdvEntreprises,
  rendezVous,
} from './schema.js';

const MAINTENANT = new Date('2026-11-12T10:00:00Z');
const jour = (n: number) => new Date(MAINTENANT.getTime() + n * 86_400_000);

// Chaque affaire du Pipeline sait si elle a un rendez-vous et quand est le prochain ; sans rendez-vous,
// c'est une personne encore en prospection : elle est aussi dans le Radar.
describe('Pipeline : rendez-vous des affaires', () => {
  let t: TestApp;
  let inst: Instance;
  beforeAll(async () => {
    t = await setupTestApp();
    inst = await createInstance(t.owner.db, { slug: 'pipe-rdv', nom: 'P', type: 'propre' });
  });
  afterAll(async () => {
    await t.drop();
  });

  const etape = ETAPES_NATIVES[0]!.id;
  const affaire = (titre: string, extra: Partial<typeof opportunites.$inferInsert> = {}) =>
    withInstance(t.owner.db, inst.id, async (tx) => {
      const [o] = await tx
        .insert(opportunites)
        .values({ instanceId: inst.id, titre, etape, ...extra })
        .returning();
      return o!;
    });
  const rdv = (debut: Date, statut = 'rdv') =>
    withInstance(t.owner.db, inst.id, async (tx) => {
      const [r] = await tx
        .insert(rendezVous)
        .values({ instanceId: inst.id, eventId: `os:${crypto.randomUUID()}`, debut, statut })
        .returning();
      return r!.id;
    });
  const lue = async (titre: string) =>
    (await getPipeline(t.app.db, inst, MAINTENANT)).opportunites.find((o) => o.titre === titre)!;

  it('une affaire sans aucun rendez-vous est marquée « sans rendez-vous », sans date', async () => {
    await affaire('Seule');
    expect(await lue('Seule')).toMatchObject({ sansRdv: true, prochainRdv: null });
  });

  it('donne le prochain rendez-vous à venir, lié par l’affaire, le contact ou l’entreprise', async () => {
    const [c] = await t.owner.db
      .insert(contacts)
      .values({ instanceId: inst.id, nom: 'Contact Fictif' })
      .returning();
    const [e] = await t.owner.db
      .insert(entreprises)
      .values({ instanceId: inst.id, nom: 'Entreprise Fictive' })
      .returning();
    const parAffaire = await affaire('ParAffaire');
    const parContact = await affaire('ParContact', { contactId: c!.id });
    const parEntreprise = await affaire('ParEntreprise', { entrepriseId: e!.id });
    await t.owner.db.insert(rdvAffaires).values({
      instanceId: inst.id,
      rendezVousId: await rdv(jour(3)),
      opportuniteId: parAffaire.id,
    });
    await t.owner.db.insert(rdvAffaires).values({
      instanceId: inst.id,
      rendezVousId: await rdv(jour(1)),
      opportuniteId: parAffaire.id,
    });
    await t.owner.db
      .insert(rdvContacts)
      .values({ instanceId: inst.id, rendezVousId: await rdv(jour(5)), contactId: c!.id });
    await t.owner.db
      .insert(rdvEntreprises)
      .values({ instanceId: inst.id, rendezVousId: await rdv(jour(7)), entrepriseId: e!.id });
    expect(parContact.id).toBeTruthy();
    expect(parEntreprise.id).toBeTruthy();
    const a = await lue('ParAffaire');
    expect(a.sansRdv).toBe(false);
    // Le plus proche des deux rendez-vous à venir.
    expect(a.prochainRdv).toBe(jour(1).toISOString());
    expect((await lue('ParContact')).prochainRdv).toBe(jour(5).toISOString());
    expect((await lue('ParEntreprise')).prochainRdv).toBe(jour(7).toISOString());
  });

  it('un rendez-vous passé suffit à ne plus être « sans rendez-vous », mais n’est plus à venir', async () => {
    const o = await affaire('Passé');
    await t.owner.db
      .insert(rdvAffaires)
      .values({ instanceId: inst.id, rendezVousId: await rdv(jour(-4)), opportuniteId: o.id });
    expect(await lue('Passé')).toMatchObject({ sansRdv: false, prochainRdv: null });
  });

  it('ignore un créneau écarté, et ne marque jamais une affaire close', async () => {
    const o = await affaire('Écarté');
    await t.owner.db.insert(rdvAffaires).values({
      instanceId: inst.id,
      rendezVousId: await rdv(jour(2), 'ignore'),
      opportuniteId: o.id,
    });
    expect(await lue('Écarté')).toMatchObject({ sansRdv: true, prochainRdv: null });
    await affaire('Perdue', { clos: 'perdu' });
    expect((await lue('Perdue')).sansRdv).toBe(false);
  });
});
