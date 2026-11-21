import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import type { Tx } from '../db.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { ajouterAuRadar } from './ajout-radar.js';
import { ChangementInvalide, pipelineSource } from './pipeline.js';
import { activites, contacts, entreprises, opportunites } from './schema.js';

const deps = { secretsDir: '/nonexistent', realWrites: false };

// Ajouter à la main une personne au Radar : entreprise, contact, affaire, étape, canal, note.
describe('Ajouter une entrée au Radar', () => {
  let t: TestApp;
  let inst: Instance;
  let autre: Instance;
  beforeAll(async () => {
    t = await setupTestApp();
    inst = await createInstance(t.owner.db, { slug: 'radar-a', nom: 'A', type: 'propre' });
    autre = await createInstance(t.owner.db, { slug: 'radar-b', nom: 'B', type: 'propre' });
  });
  afterAll(async () => {
    await t.drop();
  });

  const lire = <T>(instance: Instance, f: (tx: Tx) => Promise<T>) =>
    withInstance(t.owner.db, instance.id, f);
  const ajouter = (input: Parameters<typeof ajouterAuRadar>[2], instance = inst) =>
    ajouterAuRadar(t.app.db, instance, input, deps) as Promise<{ id: string; contactId: string }>;

  it('crée entreprise, contact et affaire à la première étape du Pipeline, étape et canal fixés', async () => {
    const r = await ajouter({
      nom: 'Alice Fictive',
      entreprise: 'Société Exemple',
      email: 'alice@exemple.test',
      canal: 'LinkedIn',
      etape: 1,
      origine: 'Origine Test',
    });
    const premiere = (await lire(inst, (tx) => pipelineSource(tx))).etapes[0]!.id;
    const [a] = await lire(inst, (tx) =>
      tx.select().from(opportunites).where(eq(opportunites.id, r.id)),
    );
    expect(a).toMatchObject({
      titre: 'Société Exemple',
      etape: premiere,
      radarEtapeManuelle: 1,
      radarCanalManuel: 'LinkedIn',
      origine: 'Origine Test',
      contactId: r.contactId,
      clos: null,
    });
  });

  it('étape 0 : aucun placement manuel enregistré', async () => {
    const r = await ajouter({ nom: 'Zoé Zéro', canal: 'E-mail', etape: 0 });
    const [a] = await lire(inst, (tx) =>
      tx.select().from(opportunites).where(eq(opportunites.id, r.id)),
    );
    expect(a?.radarEtapeManuelle).toBeNull();
    expect(a?.radarCanalManuel).toBe('E-mail');
  });

  it('nom seul : crée le contact et l’affaire, titre = nom', async () => {
    const r = await ajouter({ nom: 'Bruno Seul', canal: 'LinkedIn' });
    const [a] = await lire(inst, (tx) =>
      tx.select().from(opportunites).where(eq(opportunites.id, r.id)),
    );
    expect(a?.titre).toBe('Bruno Seul');
    expect(a?.entrepriseId).toBeNull();
  });

  it('réutilise l’entreprise de même nom, casse différente', async () => {
    await ajouter({ nom: 'Chloé Un', entreprise: 'Société Casse', canal: 'LinkedIn' });
    await ajouter({ nom: 'Denis Deux', entreprise: 'SOCIÉTÉ casse', canal: 'LinkedIn' });
    const lignes = await lire(inst, (tx) =>
      tx.select().from(entreprises).where(eq(entreprises.nom, 'Société Casse')),
    );
    expect(lignes).toHaveLength(1);
  });

  it('réutilise le contact de même adresse mail, casse différente, sans doublon', async () => {
    const un = await ajouter({ nom: 'Émile Mail', email: 'emile@exemple.test', canal: 'E-mail' });
    await lire(inst, (tx) =>
      tx.update(opportunites).set({ clos: 'perdu' }).where(eq(opportunites.id, un.id)),
    );
    const deux = await ajouter({ nom: 'Émile Mail', email: 'EMILE@Exemple.test', canal: 'E-mail' });
    expect(deux.contactId).toBe(un.contactId);
    const lignes = await lire(inst, (tx) =>
      tx.select().from(contacts).where(eq(contacts.nom, 'Émile Mail')),
    );
    expect(lignes).toHaveLength(1);
  });

  it('refuse quand le contact a déjà une affaire ouverte et ne crée rien de plus', async () => {
    await ajouter({
      nom: 'Fanny Ouverte',
      entreprise: 'Société Ouverte',
      email: 'fanny@exemple.test',
      canal: 'LinkedIn',
    });
    const avant = await lire(inst, (tx) => tx.select().from(opportunites));
    await expect(
      ajouter({
        nom: 'Fanny Ouverte',
        entreprise: 'Société Ouverte Bis',
        email: 'fanny@exemple.test',
        canal: 'LinkedIn',
      }),
    ).rejects.toThrow('déjà une affaire ouverte');
    const apres = await lire(inst, (tx) => tx.select().from(opportunites));
    expect(apres).toHaveLength(avant.length);
    const bis = await lire(inst, (tx) =>
      tx.select().from(entreprises).where(eq(entreprises.nom, 'Société Ouverte Bis')),
    );
    expect(bis).toHaveLength(0);
  });

  it('contactId fourni : crée seulement l’affaire ; contact d’une autre instance refusé', async () => {
    const [c] = await t.owner.db
      .insert(contacts)
      .values({ instanceId: inst.id, nom: 'Gaëlle Connue' })
      .returning();
    const r = await ajouter({ nom: 'ignoré', contactId: c!.id, canal: 'Téléphone' });
    expect(r.contactId).toBe(c!.id);
    expect(
      await lire(inst, (tx) => tx.select().from(contacts).where(eq(contacts.nom, 'ignoré'))),
    ).toHaveLength(0);
    await expect(
      ajouter({ nom: 'x', contactId: c!.id, canal: 'Téléphone' }, autre),
    ).rejects.toBeInstanceOf(ChangementInvalide);
  });

  it('la note devient une activité liée au contact et à l’affaire, lien LinkedIn en première ligne', async () => {
    const r = await ajouter({
      nom: 'Hugo Note',
      canal: 'LinkedIn',
      lienLinkedin: 'https://www.linkedin.com/in/hugo-fictif',
      note: 'Livre blanc envoyé',
    });
    const [n] = await lire(inst, (tx) =>
      tx.select().from(activites).where(eq(activites.opportuniteId, r.id)),
    );
    expect(n).toMatchObject({ type: 'note', contactId: r.contactId });
    expect(n?.resume?.split('\n')[0]).toBe(
      'Profil LinkedIn : https://www.linkedin.com/in/hugo-fictif',
    );
    expect(n?.resume).toContain('Livre blanc envoyé');
  });

  it('sans note ni lien : aucune activité', async () => {
    const r = await ajouter({ nom: 'Inès Sans', canal: 'LinkedIn' });
    expect(
      await lire(inst, (tx) =>
        tx.select().from(activites).where(eq(activites.opportuniteId, r.id)),
      ),
    ).toHaveLength(0);
  });
});
