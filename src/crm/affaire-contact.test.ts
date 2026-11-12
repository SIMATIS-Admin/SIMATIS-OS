import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { creerAffairePourContact } from './affaire-contact.js';
import { ChangementInvalide, ETAPES_NATIVES } from './pipeline.js';
import { contacts, entreprises, opportunites } from './schema.js';

const deps = { secretsDir: '/nonexistent', realWrites: false };

// Un prospect qui a obtenu un rendez-vous entre dans le Pipeline : une affaire, à la première étape.
describe('Créer l’affaire d’un contact', () => {
  let t: TestApp;
  let inst: Instance;
  let autre: Instance;
  beforeAll(async () => {
    t = await setupTestApp();
    inst = await createInstance(t.owner.db, { slug: 'aff-c', nom: 'A', type: 'propre' });
    autre = await createInstance(t.owner.db, { slug: 'aff-d', nom: 'B', type: 'propre' });
  });
  afterAll(async () => {
    await t.drop();
  });

  const nouveau = async (nom: string, avecEntreprise = true) => {
    const [e] = avecEntreprise
      ? await t.owner.db
          .insert(entreprises)
          .values({ instanceId: inst.id, nom: `Société ${nom}` })
          .returning()
      : [undefined];
    const [c] = await t.owner.db
      .insert(contacts)
      .values({ instanceId: inst.id, nom, entrepriseId: e?.id ?? null })
      .returning();
    return { contact: c!, entreprise: e };
  };
  const affaires = (contactId: string) =>
    withInstance(t.owner.db, inst.id, (tx) =>
      tx.select().from(opportunites).where(eq(opportunites.contactId, contactId)),
    );

  it('crée une affaire à la première étape, titrée par l’entreprise, reliée au contact', async () => {
    const { contact, entreprise } = await nouveau('Alice Fictive');
    const r = (await creerAffairePourContact(t.app.db, inst, contact.id, deps)) as { id: string };
    expect(r.id).toBeTruthy();
    const [a] = await affaires(contact.id);
    expect(a).toMatchObject({
      titre: 'Société Alice Fictive',
      etape: ETAPES_NATIVES[0]!.id,
      entrepriseId: entreprise!.id,
      clos: null,
    });
  });

  it('prend le nom du contact quand il n’a pas d’entreprise', async () => {
    const { contact } = await nouveau('Bruno Seul', false);
    await creerAffairePourContact(t.app.db, inst, contact.id, deps);
    expect((await affaires(contact.id))[0]?.titre).toBe('Bruno Seul');
  });

  it('refuse un contact qui a déjà une affaire ouverte, et en accepte une nouvelle après une affaire close', async () => {
    const { contact } = await nouveau('Chloé Deux');
    await creerAffairePourContact(t.app.db, inst, contact.id, deps);
    await expect(creerAffairePourContact(t.app.db, inst, contact.id, deps)).rejects.toBeInstanceOf(
      ChangementInvalide,
    );
    await t.owner.db
      .update(opportunites)
      .set({ clos: 'perdu' })
      .where(eq(opportunites.contactId, contact.id));
    await creerAffairePourContact(t.app.db, inst, contact.id, deps);
    expect(await affaires(contact.id)).toHaveLength(2);
  });

  it('refuse un contact inconnu ou d’un autre espace', async () => {
    const { contact } = await nouveau('Denis Ailleurs');
    await expect(creerAffairePourContact(t.app.db, autre, contact.id, deps)).rejects.toBeInstanceOf(
      ChangementInvalide,
    );
    await expect(
      creerAffairePourContact(t.app.db, inst, crypto.randomUUID(), deps),
    ).rejects.toBeInstanceOf(ChangementInvalide);
  });
});
