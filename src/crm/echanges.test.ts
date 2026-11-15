import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import type { Message } from '../connecteurs/google/google.js';
import type { Messagerie } from '../connecteurs/messagerie.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import {
  contactsAvecDiagnostic,
  finDeLecture,
  lancerLecture,
  lireEchanges,
  resumerEchanges,
} from './echanges.js';
import type { Evenement } from './fiches.js';
import { ETAPES_NATIVES, getPipeline } from './pipeline.js';
import { diagnosticProjets } from '../diagnostic/schema.js';
import {
  contactEchangesMail,
  contactEmails,
  contacts,
  entreprises,
  opportunites,
  rdvContacts,
  rendezVous,
  taches,
} from './schema.js';

const deps = { secretsDir: '/inexistant', realWrites: false };
const MOI = 'moi@exemple.test';

const mail = (sens: 'envoye' | 'recu', de: string, at: string, objet = 'Sujet fictif') =>
  ({
    id: `m-${Math.random()}`,
    type: 'email',
    titre: objet,
    texte: null,
    at,
    origine: 'os',
    mail: { fil: 'f', objet, de, a: null, sens, reponse: false },
  }) satisfies Evenement;

describe('resumerEchanges', () => {
  const adresses = ['alice@fictive.test'];

  it('compte les mails envoyés et les vraies réponses du contact, avec les dernières dates', () => {
    const r = resumerEchanges(
      [
        mail('envoye', MOI, '2026-10-01T09:00:00Z'),
        mail('envoye', MOI, '2026-10-08T09:00:00Z'),
        mail('recu', 'Alice <alice@fictive.test>', '2026-10-09T09:00:00Z'),
      ],
      adresses,
    );
    expect(r).toEqual({
      envoyes: 2,
      recus: 1,
      dernierEnvoi: new Date('2026-10-08T09:00:00Z'),
      dernierRecu: new Date('2026-10-09T09:00:00Z'),
    });
  });

  it('ne prend pour réponse ni une absence, ni un retour en erreur, ni un tiers en copie', () => {
    const r = resumerEchanges(
      [
        mail('envoye', MOI, '2026-10-01T09:00:00Z'),
        mail('recu', 'alice@fictive.test', '2026-10-01T10:00:00Z', 'Réponse automatique : absente'),
        mail('recu', 'MAILER-DAEMON@exemple.test', '2026-10-01T09:01:00Z', 'Undeliverable'),
        mail('recu', 'bob@autre.test', '2026-10-02T09:00:00Z'),
      ],
      adresses,
    );
    expect(r).toMatchObject({ envoyes: 1, recus: 0, dernierRecu: null });
  });
});

describe('Affaires sans rendez-vous rangées par la messagerie', () => {
  let t: TestApp;
  let inst: Instance;
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    t = await setupTestApp();
    inst = await createInstance(t.owner.db, { slug: 'echanges', nom: 'E', type: 'propre' });
    await withInstance(t.owner.db, inst.id, async (tx) => {
      const [societe] = await tx
        .insert(entreprises)
        .values({ instanceId: inst.id, nom: 'Societe Fictive' })
        .returning();
      const noms = ['muet', 'repond', 'collegue', 'jamais', 'avecRdv'] as const;
      for (const nom of noms) {
        const [c] = await tx
          .insert(contacts)
          .values({
            instanceId: inst.id,
            nom,
            entrepriseId: nom === 'repond' || nom === 'collegue' ? societe!.id : null,
          })
          .returning();
        ids[nom] = c!.id;
        await tx
          .insert(contactEmails)
          .values({ instanceId: inst.id, contactId: c!.id, email: `${nom}@fictive.test` });
      }
      const etape = ETAPES_NATIVES[0]!.id;
      await tx.insert(opportunites).values([
        { instanceId: inst.id, titre: 'Muette', etape, contactId: ids.muet },
        // Le contact principal n'a pas répondu, sa collègue de la même entreprise si.
        {
          instanceId: inst.id,
          titre: 'Collègue',
          etape,
          contactId: ids.collegue,
          entrepriseId: societe!.id,
        },
        { instanceId: inst.id, titre: 'Jamais', etape, contactId: ids.jamais },
        { instanceId: inst.id, titre: 'AvecRdv', etape, contactId: ids.avecRdv },
      ]);
      // Approchés hors messagerie : une tâche faite (message LinkedIn), une tâche encore à faire.
      const [linkedin, aFaire, diag] = await tx
        .insert(contacts)
        .values(['linkedin', 'aFaire', 'diag'].map((nom) => ({ instanceId: inst.id, nom })))
        .returning();
      ids.diag = diag!.id;
      await tx
        .insert(contactEmails)
        .values({ instanceId: inst.id, contactId: diag!.id, email: 'diag@fictive.test' });
      const [affLinkedin, affAFaire] = await tx
        .insert(opportunites)
        .values([
          { instanceId: inst.id, titre: 'LinkedIn', etape, contactId: linkedin!.id },
          { instanceId: inst.id, titre: 'AFaire', etape, contactId: aFaire!.id },
          // Diagnostic réalisé : au moins en Qualification, jamais au Radar, même écrite sans réponse.
          { instanceId: inst.id, titre: 'Diag', etape, contactId: diag!.id },
        ])
        .returning();
      await tx.insert(taches).values([
        {
          instanceId: inst.id,
          titre: 'Message LinkedIn fictif',
          canal: 'tache',
          contactId: linkedin!.id,
          faitAt: new Date('2026-10-02T09:00:00Z'),
        },
        {
          instanceId: inst.id,
          titre: 'Message LinkedIn fictif',
          canal: 'tache',
          opportuniteId: affAFaire!.id,
        },
      ]);
      void affLinkedin;
      await tx
        .insert(diagnosticProjets)
        .values({
          instanceId: inst.id,
          nom: 'Diag fictif',
          activite: 'services',
          contactId: diag!.id,
        });
      await tx
        .insert(contactEchangesMail)
        .values({ instanceId: inst.id, contactId: diag!.id, envoyes: 3, recus: 0 });
      const [rdv] = await tx
        .insert(rendezVous)
        .values({ instanceId: inst.id, eventId: 'os:ech', statut: 'rdv' })
        .returning();
      await tx
        .insert(rdvContacts)
        .values({ instanceId: inst.id, rendezVousId: rdv!.id, contactId: ids.avecRdv! });
    });
  });
  afterAll(async () => {
    await t.drop();
  });

  const msg = (id: string, de: string, a: string): Message => ({
    id,
    date: '2026-10-05T09:00:00Z',
    de,
    a,
    objet: 'Proposition fictive',
    extrait: '',
  });
  const lus: string[] = [];
  const boite: Messagerie = {
    historique: (email) => {
      lus.push(email);
      const parAdresse: Record<string, Message[]> = {
        'muet@fictive.test': [msg('1', MOI, 'muet@fictive.test')],
        'collegue@fictive.test': [msg('2', MOI, 'collegue@fictive.test')],
        'repond@fictive.test': [
          msg('3', MOI, 'repond@fictive.test'),
          msg('4', 'repond@fictive.test', MOI),
        ],
        'avecRdv@fictive.test': [msg('5', MOI, 'avecRdv@fictive.test')],
      };
      return Promise.resolve(parAdresse[email] ?? []);
    },
    filsRecents: () => Promise.resolve([]),
    brouillons: () => Promise.resolve([]),
    compte: () => Promise.resolve(MOI),
  };
  const boitesDe = () => Promise.resolve([boite]);

  it('lit la messagerie des seuls contacts des affaires ouvertes sans rendez-vous ni diagnostic', async () => {
    const r = await lireEchanges(t.app.db, inst, deps, boitesDe);
    expect(r).toEqual({ contacts: 4, erreurs: 0 });
    expect(lus.sort()).toEqual(
      ['collegue', 'jamais', 'muet', 'repond'].map((n) => `${n}@fictive.test`),
    );
    const lignes = await t.owner.db.select().from(contactEchangesMail);
    expect(lignes.find((l) => l.contactId === ids.repond)).toMatchObject({ envoyes: 1, recus: 1 });
    expect(lignes.find((l) => l.contactId === ids.muet)).toMatchObject({ envoyes: 1, recus: 0 });
  });

  it('range chaque affaire du Pipeline : sans réponse, a répondu, ou reste au Pipeline', async () => {
    const pipe = await getPipeline(t.app.db, inst);
    const radar = (titre: string) => pipe.opportunites.find((o) => o.titre === titre)?.radar;
    expect(radar('Muette')).toBe('sans_reponse');
    expect(radar('Collègue')).toBe('repondu');
    expect(radar('Jamais')).toBeNull();
    expect(radar('AvecRdv')).toBeNull();
  });

  it('range aussi au Radar une affaire approchée par une tâche faite (LinkedIn…), pas par une tâche à faire', async () => {
    const pipe = await getPipeline(t.app.db, inst);
    const radar = (titre: string) => pipe.opportunites.find((o) => o.titre === titre)?.radar;
    expect(radar('LinkedIn')).toBe('sans_reponse');
    expect(radar('AFaire')).toBeNull();
  });

  it('garde au Pipeline, au moins en Qualification, une affaire avec diagnostic', async () => {
    const pipe = await getPipeline(t.app.db, inst);
    expect(pipe.opportunites.find((o) => o.titre === 'Diag')).toMatchObject({
      radar: null,
      diagnostic: true,
      sansRdv: false,
      etape: 'qualification',
      etapeCrm: ETAPES_NATIVES[0]!.id,
    });
    expect(pipe.opportunites.find((o) => o.titre === 'Muette')).toMatchObject({
      diagnostic: false,
      etapeCrm: null,
    });
  });

  it('ne fait pas reculer une affaire avec diagnostic déjà plus loin que la Qualification', async () => {
    await withInstance(t.owner.db, inst.id, (tx) =>
      tx
        .update(opportunites)
        .set({ etape: 'proposition' })
        .where(and(eq(opportunites.instanceId, inst.id), eq(opportunites.titre, 'Diag'))),
    );
    const pipe = await getPipeline(t.app.db, inst);
    expect(pipe.opportunites.find((o) => o.titre === 'Diag')).toMatchObject({
      etape: 'proposition',
      etapeCrm: null,
    });
  });

  it('reconnaît les contacts avec diagnostic, par eux-mêmes ou par leur entreprise', async () => {
    const avec = await contactsAvecDiagnostic(t.app.db, inst.id);
    expect(avec.has(ids.diag!)).toBe(true);
    expect(avec.has(ids.muet!)).toBe(false);
  });

  it('une boîte illisible ne remet pas à zéro ce qu’une lecture précédente a trouvé', async () => {
    const enPanne: Messagerie = {
      ...boite,
      historique: () => Promise.reject(new Error('jeton expiré')),
    };
    const r = await lireEchanges(t.app.db, inst, deps, () => Promise.resolve([enPanne]));
    expect(r).toEqual({ contacts: 0, erreurs: 4 });
    const pipe = await getPipeline(t.app.db, inst);
    expect(pipe.opportunites.find((o) => o.titre === 'Muette')?.radar).toBe('sans_reponse');
  });

  it('ne relance pas une lecture récente, sauf à la demande', async () => {
    const auto = await lancerLecture(t.app.db, inst, deps, { boitesDe });
    expect(auto.lancee).toBe(false);
    expect(auto.derniereLecture).not.toBeNull();
    const forcee = await lancerLecture(t.app.db, inst, deps, { boitesDe, force: true });
    expect(forcee).toMatchObject({ lancee: true, etat: 'en_cours' });
    await finDeLecture(inst.id);
    const plusTard = new Date(Date.now() + 7 * 3_600_000);
    expect(
      (await lancerLecture(t.app.db, inst, deps, { boitesDe, maintenant: plusTard })).lancee,
    ).toBe(true);
    await finDeLecture(inst.id);
  });

  it('sans messagerie connectée, la lecture échoue avec un message clair', async () => {
    const autre = await createInstance(t.owner.db, {
      slug: 'echanges-sans',
      nom: 'S',
      type: 'propre',
    });
    await expect(lireEchanges(t.app.db, autre, deps, () => Promise.resolve([]))).rejects.toThrow(
      /Aucune messagerie/,
    );
  });
});
