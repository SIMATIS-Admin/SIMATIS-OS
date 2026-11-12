import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { withInstance } from '../db/context.js';
import { createInstance } from '../instances/service.js';
import {
  contacts,
  entreprises,
  opportunites,
  rdvAffaires,
  rdvContacts,
  rdvEntreprises,
  rendezVous,
} from './schema.js';
import { searchContacts, searchEntreprises } from './service.js';

// Statut d'un contact ou d'une entreprise du CRM, déduit des données :
// client = une affaire gagnée, prospect = un rendez-vous commercial, suspect = le reste.
describe('statut suspect / prospect / client', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await setupTestApp();
  });
  afterAll(async () => {
    await t.drop();
  });

  it('déduit le statut des affaires gagnées et des rendez-vous, sans rien écrire', async () => {
    const inst = await createInstance(t.owner.db, { slug: 'statuts', nom: 'S', type: 'mandat' });
    const ids = await withInstance(t.owner.db, inst.id, async (tx) => {
      const [eSuspect, eProspect, eClient, eRdvEntreprise, eAffaire, eIgnore] = await tx
        .insert(entreprises)
        .values(
          ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'].map((nom) => ({
            instanceId: inst.id,
            nom,
          })),
        )
        .returning();
      const [cSuspect, cProspect, cClient, cRdvEntreprise, cAffaire, cIgnore] = await tx
        .insert(contacts)
        .values(
          [eSuspect, eProspect, eClient, eRdvEntreprise, eAffaire, eIgnore].map((e, i) => ({
            instanceId: inst.id,
            nom: `Contact ${i}`,
            entrepriseId: e!.id,
          })),
        )
        .returning();
      const [rdv, rdvPasUn] = await tx
        .insert(rendezVous)
        .values([
          { instanceId: inst.id, eventId: 'e1', statut: 'rdv' },
          { instanceId: inst.id, eventId: 'e2', statut: 'ignore' },
        ])
        .returning();
      await tx.insert(rdvContacts).values([
        { instanceId: inst.id, rendezVousId: rdv!.id, contactId: cProspect!.id },
        { instanceId: inst.id, rendezVousId: rdvPasUn!.id, contactId: cIgnore!.id },
      ]);
      await tx
        .insert(rdvEntreprises)
        .values({ instanceId: inst.id, rendezVousId: rdv!.id, entrepriseId: eRdvEntreprise!.id });
      const [oppOuverte, oppGagnee] = await tx
        .insert(opportunites)
        .values([
          {
            instanceId: inst.id,
            titre: 'Ouverte',
            etape: 'x',
            entrepriseId: eAffaire!.id,
            contactId: cAffaire!.id,
          },
          {
            instanceId: inst.id,
            titre: 'Gagnée',
            etape: 'x',
            clos: 'gagne',
            entrepriseId: eClient!.id,
            contactId: cClient!.id,
          },
        ])
        .returning();
      await tx
        .insert(rdvAffaires)
        .values({ instanceId: inst.id, rendezVousId: rdv!.id, opportuniteId: oppOuverte!.id });
      void oppGagnee;
      return { cSuspect, cProspect, cClient, cRdvEntreprise, cAffaire, cIgnore };
    });

    const parNom = async () =>
      Object.fromEntries((await searchContacts(t.app.db, inst.id)).map((c) => [c.nom, c.statut]));
    const statuts = await parNom();
    expect(statuts[ids.cSuspect!.nom]).toBe('suspect');
    expect(statuts[ids.cProspect!.nom]).toBe('prospect');
    expect(statuts[ids.cClient!.nom]).toBe('client');
    // Le rendez-vous de l'entreprise ou de l'affaire suffit ; un créneau écarté ne compte pas.
    expect(statuts[ids.cRdvEntreprise!.nom]).toBe('prospect');
    expect(statuts[ids.cAffaire!.nom]).toBe('prospect');
    expect(statuts[ids.cIgnore!.nom]).toBe('suspect');

    const societes = Object.fromEntries(
      (await searchEntreprises(t.app.db, inst.id)).map((e) => [e.nom, e.statut]),
    );
    expect(societes).toMatchObject({
      Alpha: 'suspect',
      Beta: 'prospect',
      Gamma: 'client',
      Delta: 'prospect',
      Epsilon: 'prospect',
      Zeta: 'suspect',
    });
  });
});
