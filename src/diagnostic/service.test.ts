import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { createInstance } from '../instances/service.js';
import { entreprises } from '../crm/schema.js';
import type { Instance } from '../instances/schema.js';
import {
  AffaireIntrouvable,
  ContactIntrouvable,
  createProjet,
  DiagnosticIndisponible,
  EntrepriseIntrouvable,
  listProjets,
  ProjetIntrouvable,
  updateProjet,
} from './service.js';

describe('Diagnostic : projets', () => {
  let t: TestApp;
  let simatis: Instance;
  let autre: Instance;
  let mandat: Instance;

  beforeAll(async () => {
    t = await setupTestApp();
    simatis = await createInstance(t.owner.db, {
      slug: 'simatis-diag',
      nom: 'SIMATIS',
      type: 'propre',
    });
    autre = await createInstance(t.owner.db, {
      slug: 'simatis-diag-2',
      nom: 'Autre',
      type: 'propre',
    });
    mandat = await createInstance(t.owner.db, {
      slug: 'mandat-diag',
      nom: 'Mandat',
      type: 'mandat',
    });
  });

  afterAll(async () => {
    await t.drop();
  });

  it('crée un projet à l étape 1, sans profil tant que le résultat n est pas saisi', async () => {
    const p = await createProjet(t.app.db, simatis, {
      nom: '  Atelier Fictif Nord ',
      activite: 'usinage',
    });
    expect(p).toMatchObject({
      nom: 'Atelier Fictif Nord',
      activite: 'usinage',
      etape: 1,
      profil: null,
    });
    expect(await listProjets(t.app.db, simatis)).toEqual([expect.objectContaining({ id: p.id })]);
  });

  it('calcule le profil en cascade une fois le résultat saisi', async () => {
    const p = await createProjet(t.app.db, simatis, { nom: 'Bureau Fictif', activite: 'services' });
    const saisi = await updateProjet(t.app.db, simatis, p.id, {
      etape: 2,
      dims: { outils: 6.5, strategie: 4, polyvalence: 9 },
      statutDiagnostic: 'Restitué',
      dateDiagnostic: '2026-10-06',
    });
    expect(saisi).toMatchObject({ etape: 2, profil: 'Sprinteur', dateDiagnostic: '2026-10-06' });
  });

  it("retient l'étape la plus haute atteinte, même après un retour en arrière", async () => {
    const p = await createProjet(t.app.db, simatis, { nom: 'Retour Fictif', activite: 'autre' });
    await updateProjet(t.app.db, simatis, p.id, { etape: 3 });
    const revenu = await updateProjet(t.app.db, simatis, p.id, { etape: 1 });
    expect(revenu).toMatchObject({ etape: 1, etapeMax: 3 });
  });

  it("refuse l'accès à un mandat, en lecture comme en écriture", async () => {
    await expect(listProjets(t.app.db, mandat)).rejects.toBeInstanceOf(DiagnosticIndisponible);
    await expect(
      createProjet(t.app.db, mandat, { nom: 'X', activite: 'autre' }),
    ).rejects.toBeInstanceOf(DiagnosticIndisponible);
  });

  it("ne montre pas les projets d'une autre instance", async () => {
    const dansAutre = await createProjet(t.app.db, autre, { nom: 'Ailleurs', activite: 'autre' });
    const visibles = await listProjets(t.app.db, simatis);
    expect(visibles.map((p) => p.id)).not.toContain(dansAutre.id);
    await expect(
      updateProjet(t.app.db, simatis, dansAutre.id, { etape: 3 }),
    ).rejects.toBeInstanceOf(ProjetIntrouvable);
  });

  it('garde les conversations de chaque étape avec le projet', async () => {
    const p = await createProjet(t.app.db, simatis, { nom: 'Chat Fictif', activite: 'batiment' });
    const avecChat = await updateProjet(t.app.db, simatis, p.id, {
      chats: { '3': { modele: 'opus', effort: 'max', lien: 'https://claude.ai/chat/fictif' } },
    });
    const relu = (await listProjets(t.app.db, simatis)).find((x) => x.id === p.id);
    expect(avecChat.chats['3']).toEqual({
      modele: 'opus',
      effort: 'max',
      lien: 'https://claude.ai/chat/fictif',
    });
    expect(relu?.chats['3']?.modele).toBe('opus');
  });

  it('garde le formulaire de revue saisi dans l OS', async () => {
    const p = await createProjet(t.app.db, simatis, { nom: 'Revue Fictive', activite: 'batiment' });
    const revue = {
      statut: 'brouillon',
      preconisations: { r1: { choix: 'garder', detail: 'Commentaire fictif.' } },
    };
    const saisi = await updateProjet(t.app.db, simatis, p.id, { revue });
    expect(saisi.revue).toEqual(revue);
  });
});

describe('Diagnostic : colonnes de l entretien', () => {
  let t: TestApp;
  let simatis: Instance;

  beforeAll(async () => {
    t = await setupTestApp();
    simatis = await createInstance(t.owner.db, {
      slug: 'simatis-entretien-colonnes',
      nom: 'SIMATIS',
      type: 'propre',
    });
  });

  afterAll(async () => {
    await t.drop();
  });

  it('un projet neuf n a ni réponses, ni historique, ni PDF', async () => {
    const p = await createProjet(t.app.db, simatis, {
      nom: 'Entretien Fictif A',
      activite: 'services',
    });
    const relu = (await listProjets(t.app.db, simatis)).find((x) => x.id === p.id)!;
    expect(relu.reponsesEntretien).toEqual([]);
    expect(relu.historiqueReponses).toEqual([]);
    expect(relu.pdfEntretienNom).toBeNull();
  });

  it('un projet neuf n a pas de capitalisation de la restitution', async () => {
    const p = await createProjet(t.app.db, simatis, {
      nom: 'Capitalisation Fictive A',
      activite: 'services',
    });
    const relu = (await listProjets(t.app.db, simatis)).find((x) => x.id === p.id)!;
    expect(relu.capitalisationStatut).toBe('aucun');
    expect(relu.capitalisationRdvId).toBeNull();
    expect(relu.capitalisationCompteRenduAt).toBeNull();
  });

  it('rattache un projet à une entreprise et la garde à la relecture', async () => {
    const [e] = await t.owner.db
      .insert(entreprises)
      .values({ instanceId: simatis.id, nom: 'Entreprise Fictive A' })
      .returning({ id: entreprises.id });
    const p = await createProjet(t.app.db, simatis, {
      nom: 'Projet rattaché',
      activite: 'Conseil',
      entrepriseId: e!.id,
    });
    const relu = (await listProjets(t.app.db, simatis)).find((x) => x.id === p.id)!;
    expect(relu.entrepriseId).toBe(e!.id);
  });

  it('lie le projet à une organisation et à un contact, changeables ensuite', async () => {
    const ids = async (i: Instance) => {
      const e = await t.owner.pool.query<{ id: string }>(
        "insert into entreprises (instance_id, nom) values ($1, 'Atelier Lié') returning id",
        [i.id],
      );
      const c = await t.owner.pool.query<{ id: string }>(
        "insert into contacts (instance_id, nom) values ($1, 'Dirigeant Lié') returning id",
        [i.id],
      );
      return { entrepriseId: e.rows[0]!.id, contactId: c.rows[0]!.id };
    };
    const liens = await ids(simatis);
    const p = await createProjet(t.app.db, simatis, { nom: 'Lié', activite: 'usinage', ...liens });
    expect(p).toMatchObject(liens);
    const delie = await updateProjet(t.app.db, simatis, p.id, { contactId: null });
    expect(delie).toMatchObject({ entrepriseId: liens.entrepriseId, contactId: null });
    const autres = await ids(simatis);
    expect(await updateProjet(t.app.db, simatis, p.id, autres)).toMatchObject(autres);
  });

  it('refuse une organisation ou un contact inconnu ou d’une autre instance', async () => {
    const inconnu = '00000000-0000-4000-8000-000000000000';
    await expect(
      createProjet(t.app.db, simatis, { nom: 'X', activite: 'usinage', entrepriseId: inconnu }),
    ).rejects.toBeInstanceOf(EntrepriseIntrouvable);
    await expect(
      createProjet(t.app.db, simatis, { nom: 'X', activite: 'usinage', contactId: inconnu }),
    ).rejects.toBeInstanceOf(ContactIntrouvable);
    const autre = await createInstance(t.owner.db, {
      slug: 'diag-autre-lien',
      nom: 'Autre',
      type: 'propre',
    });
    const c = await t.owner.pool.query<{ id: string }>(
      "insert into contacts (instance_id, nom) values ($1, 'Ailleurs') returning id",
      [autre.id],
    );
    const p = await createProjet(t.app.db, simatis, { nom: 'Y', activite: 'usinage' });
    await expect(
      updateProjet(t.app.db, simatis, p.id, { contactId: c.rows[0]!.id }),
    ).rejects.toBeInstanceOf(ContactIntrouvable);
  });
  it('lie le projet à une affaire, changeable ensuite, et la délie si l’affaire disparaît', async () => {
    const affaire = async (i: Instance) =>
      (
        await t.owner.pool.query<{ id: string }>(
          "insert into opportunites (instance_id, titre, etape) values ($1, 'Affaire Liée', 'detection') returning id",
          [i.id],
        )
      ).rows[0]!.id;
    const a1 = await affaire(simatis);
    const p = await createProjet(t.app.db, simatis, {
      nom: 'Lié Affaire',
      activite: 'usinage',
      opportuniteId: a1,
    });
    expect(p.opportuniteId).toBe(a1);
    const a2 = await affaire(simatis);
    expect((await updateProjet(t.app.db, simatis, p.id, { opportuniteId: a2 })).opportuniteId).toBe(
      a2,
    );
    await t.owner.pool.query('delete from opportunites where id = $1', [a2]);
    const relu = (await listProjets(t.app.db, simatis)).find((x) => x.id === p.id)!;
    expect(relu.opportuniteId).toBeNull();
    expect((await updateProjet(t.app.db, simatis, p.id, { opportuniteId: a1 })).opportuniteId).toBe(
      a1,
    );
    expect(
      (await updateProjet(t.app.db, simatis, p.id, { opportuniteId: null })).opportuniteId,
    ).toBeNull();
  });

  it('refuse une affaire inconnue ou d’une autre instance', async () => {
    const inconnu = '00000000-0000-4000-8000-000000000000';
    await expect(
      createProjet(t.app.db, simatis, { nom: 'X', activite: 'usinage', opportuniteId: inconnu }),
    ).rejects.toBeInstanceOf(AffaireIntrouvable);
    const autre = await createInstance(t.owner.db, {
      slug: 'diag-autre-affaire',
      nom: 'Autre',
      type: 'propre',
    });
    const o = await t.owner.pool.query<{ id: string }>(
      "insert into opportunites (instance_id, titre, etape) values ($1, 'Ailleurs', 'detection') returning id",
      [autre.id],
    );
    const p = await createProjet(t.app.db, simatis, { nom: 'Y', activite: 'usinage' });
    await expect(
      updateProjet(t.app.db, simatis, p.id, { opportuniteId: o.rows[0]!.id }),
    ).rejects.toBeInstanceOf(AffaireIntrouvable);
  });
});
