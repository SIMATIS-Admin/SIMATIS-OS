import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insererFiche } from '../../test/fiche-base.js';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { etatRadar } from '../base-vivante/radar.js';
import { contacts, entreprises, rdvContacts, rdvEntreprises, rendezVous } from '../crm/schema.js';
import { withInstance } from '../db/context.js';
import { createInstance } from '../instances/service.js';
import { echantillonFroid } from './froid.js';
import { prospectionSuiviFroid } from './schema.js';

// Dès qu'un contact obtient un rendez-vous, la séquence à froid s'arrête pour lui.
describe('Séquence à froid : arrêt au rendez-vous', () => {
  let t: TestApp;
  let inst: string;
  beforeAll(async () => {
    t = await setupTestApp();
    inst = (await createInstance(t.owner.db, { slug: 'arret-rdv', nom: 'A', type: 'propre' })).id;
  });
  afterAll(async () => {
    await t.drop();
  });

  let n = 0;
  const fiche = async (extra: { crmContactId?: string; touches?: number } = {}) => {
    n += 1;
    const id = await insererFiche(t.owner.db, {
      instanceId: inst,
      zone: 'prospectable',
      entreprise: `Atelier Fictif ${n}`,
      prenom: 'Camille',
      nom: `Dupré${n}`,
      email: `arret${n}@fictif.test`,
      provenance: 'Salon fictif',
      ...(extra.crmContactId ? { crmContactId: extra.crmContactId } : {}),
    });
    if (extra.touches)
      await t.owner.db.insert(prospectionSuiviFroid).values({
        instanceId: inst,
        baseId: id,
        touches: extra.touches,
        touchesMax: 4,
        derniereLe: new Date(Date.now() - 30 * 86_400_000),
      });
    return { id, email: `arret${n}@fictif.test`, entreprise: `Atelier Fictif ${n}` };
  };
  const rdv = (statut: string) =>
    withInstance(t.owner.db, inst, async (tx) => {
      const [r] = await tx
        .insert(rendezVous)
        .values({ instanceId: inst, eventId: `os:${crypto.randomUUID()}`, statut })
        .returning();
      return r!.id;
    });
  const eligibles = async () =>
    (await withInstance(t.app.db, inst, (tx) => echantillonFroid(tx, { nombre: 500 }))).map(
      (c) => c.id,
    );

  it('retire de la séquence un contact lié au CRM qui a un rendez-vous', async () => {
    const [c] = await t.owner.db
      .insert(contacts)
      .values({ instanceId: inst, nom: 'Lié Au Crm' })
      .returning();
    const lie = await fiche({ crmContactId: c!.id, touches: 1 });
    const libre = await fiche({ touches: 1 });
    expect(await eligibles()).toEqual(expect.arrayContaining([lie.id, libre.id]));
    const r = await rdv('rdv');
    await t.owner.db
      .insert(rdvContacts)
      .values({ instanceId: inst, rendezVousId: r, contactId: c!.id });
    const apres = await eligibles();
    expect(apres).not.toContain(lie.id);
    expect(apres).toContain(libre.id);
  });

  it("le retire aussi quand le contact du CRM n'est relié que par son e-mail, ou par son entreprise", async () => {
    const parMail = await fiche({ touches: 1 });
    await t.owner.db
      .insert(contacts)
      .values({ instanceId: inst, nom: 'Même Mail', email: parMail.email.toUpperCase() });
    const [e] = await t.owner.db
      .insert(entreprises)
      .values({ instanceId: inst, nom: 'Entreprise Du Rdv' })
      .returning();
    const [c] = await t.owner.db
      .insert(contacts)
      .values({ instanceId: inst, nom: 'Collègue', entrepriseId: e!.id })
      .returning();
    const parEntreprise = await fiche({ crmContactId: c!.id, touches: 1 });
    const r = await rdv('rdv');
    await t.owner.db
      .insert(rdvEntreprises)
      .values({ instanceId: inst, rendezVousId: r, entrepriseId: e!.id });
    const [mail] = await t.owner.db.select().from(contacts).where(eq(contacts.nom, 'Même Mail'));
    const r2 = await rdv('rdv');
    await t.owner.db
      .insert(rdvContacts)
      .values({ instanceId: inst, rendezVousId: r2, contactId: mail!.id });
    const ids = await eligibles();
    expect(ids).not.toContain(parMail.id);
    expect(ids).not.toContain(parEntreprise.id);
  });

  it("garde dans la séquence un contact dont le rendez-vous a été écarté, et n'enlève jamais les autres", async () => {
    const [c] = await t.owner.db
      .insert(contacts)
      .values({ instanceId: inst, nom: 'Rdv Écarté' })
      .returning();
    const f = await fiche({ crmContactId: c!.id, touches: 1 });
    const r = await rdv('ignore');
    await t.owner.db
      .insert(rdvContacts)
      .values({ instanceId: inst, rendezVousId: r, contactId: c!.id });
    expect(await eligibles()).toContain(f.id);
  });

  it('le Radar ne compte plus dans Contactés la personne qui a un rendez-vous', async () => {
    const [c] = await t.owner.db
      .insert(contacts)
      .values({ instanceId: inst, nom: 'Radar Rdv' })
      .returning();
    const f = await fiche({ crmContactId: c!.id, touches: 2 });
    const avant = await etatRadar(t.app.db, inst, 200);
    expect(avant.contactes.fiches.map((x) => x.id)).toContain(f.id);
    const r = await rdv('rdv');
    await t.owner.db
      .insert(rdvContacts)
      .values({ instanceId: inst, rendezVousId: r, contactId: c!.id });
    const apres = await etatRadar(t.app.db, inst, 200);
    expect(apres.contactes.fiches.map((x) => x.id)).not.toContain(f.id);
    expect(apres.contactes.total).toBe(avant.contactes.total - 1);
  });
});
