import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  changement,
  creerClient,
  lireLot,
  lot,
  reference,
  relaisSimule,
  type Changement,
  type ChangementLu,
  type Client,
} from 'os-agents-relay';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { demoPortal, fakePortal } from '../../test/hubspot-portal.js';
import { buildApp } from '../app.js';
import { hubspotConnector } from '../connecteurs/hubspot/index.js';
import { configureConnexion, registerConnector, syncConnexion } from '../connexions/service.js';
import {
  activites,
  affaireContacts,
  affaireEntreprises,
  contactEmails,
  contactEntreprises,
  contacts,
  entreprises,
  opportunites,
  rdvAffaires,
  rdvContacts,
  rendezVous,
  taches,
} from '../crm/schema.js';
import { withInstance } from '../db/context.js';
import { sujets } from '../inbox/schema.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { propositions } from '../propositions/schema.js';
import { decide } from '../propositions/service.js';
import { loadInstanceSecrets } from '../secrets.js';
import { tourPartenaires } from './releve.js';
import { crmPartages, partenaires } from './schema.js';
import type { RelaisDeps } from './service.js';
import { synchroniser } from './synchro.js';
import './types-propositions.js';

// Every name and value below is fictitious.
describe('Partenaires : suivi commercial partagé (profil crm/1)', () => {
  let t: TestApp;
  let app: FastifyInstance;
  let secretsDir: string;
  let relais: ReturnType<typeof relaisSimule>;
  let alpes: Client;
  let alpesNoeud: string;
  let client: Instance;
  let autre: Instance;
  let deps: RelaisDeps;
  let noeud: string;
  const ids = {} as Record<'E1' | 'C1' | 'A1' | 'T1' | 'R1' | 'R2' | 'N1', string>;

  const owner = () => t.owner.db;
  const ref = (id: string) => reference(noeud, id);
  const tour = () => tourPartenaires(t.app.db, client, deps);
  const connexion = async () => {
    const [p] = await withInstance(t.app.db, client.id, (tx) => tx.select().from(partenaires));
    if (!p) throw new Error('partenaire absent');
    return p;
  };

  // What Alpes OS receives of the sales follow-up.
  const lotsAlpes = async () => {
    const { enveloppes } = await alpes.boite();
    if (enveloppes.length) await alpes.acquitter(enveloppes.map((e) => e.id));
    return enveloppes.filter((e) => e.type === 'donnee').map((e) => lireLot(e.corps));
  };
  const recusAlpes = async (): Promise<ChangementLu[]> =>
    (await lotsAlpes()).flatMap((l) => l.changements);
  const envoyerAlpes = async (changements: Changement[]) =>
    alpes.envoyer({
      connexion: (await connexion()).connexionId,
      type: 'donnee',
      corps: lot({ changements }),
    });
  const dans = (secondes: number) => new Date(Date.now() + secondes * 1000).toISOString();

  const ligne = async <T>(fn: () => Promise<T[]>) => {
    const [r] = await fn();
    if (!r) throw new Error('ligne absente');
    return r;
  };
  const affaire = () =>
    ligne(() => owner().select().from(opportunites).where(eq(opportunites.id, ids.A1)));
  const sujetsPartenaire = () =>
    withInstance(t.app.db, client.id, (tx) =>
      tx.select().from(sujets).where(eq(sujets.origine, 'partenaire')).orderBy(sujets.createdAt),
    );

  async function seed(i: Instance) {
    const db = owner();
    const instanceId = i.id;
    const [e] = await db
      .insert(entreprises)
      .values({
        instanceId,
        nom: 'Scierie Fictive',
        ville: 'Villefictive',
        taille: 12,
        secteur: 'Bois',
      })
      .returning();
    const [c] = await db
      .insert(contacts)
      .values({
        instanceId,
        nom: 'Jeanne Exemple',
        fonction: 'Gérante',
        email: 'jeanne@exemple.test',
        telephone: '+33 6 00 00 00 00',
        entrepriseId: e!.id,
      })
      .returning();
    await db.insert(contactEntreprises).values({
      instanceId,
      contactId: c!.id,
      entrepriseId: e!.id,
      principal: true,
    });
    await db
      .insert(contactEmails)
      .values({ instanceId, contactId: c!.id, email: 'j.exemple@exemple.test' });
    const [a] = await db
      .insert(opportunites)
      .values({
        instanceId,
        titre: 'Diagnostic fictif',
        etape: 'qualification',
        montant: 9000,
        echeance: '2026-12-15',
        entrepriseId: e!.id,
        contactId: c!.id,
        qualification: { besoin: 3, decideur: 2, budget: 2, timing: 1, engagement: 2 },
        potentiel: 'fort',
      })
      .returning();
    await db
      .insert(affaireContacts)
      .values({ instanceId, opportuniteId: a!.id, contactId: c!.id, principal: true });
    await db
      .insert(affaireEntreprises)
      .values({ instanceId, opportuniteId: a!.id, entrepriseId: e!.id, principal: true });
    const [tache] = await db
      .insert(taches)
      .values({
        instanceId,
        titre: 'Rappeler Jeanne',
        canal: 'appel',
        type: 'appel',
        contactId: c!.id,
        opportuniteId: a!.id,
        echeance: new Date('2026-11-10T09:00:00Z'),
      })
      .returning();
    const [r1] = await db
      .insert(rendezVous)
      .values({
        instanceId,
        eventId: `evt-fictif-${randomUUID()}`,
        titre: 'Premier rendez-vous',
        statut: 'rdv',
        debut: new Date('2026-11-05T09:00:00Z'),
        fin: new Date('2026-11-05T10:00:00Z'),
        participants: ['jeanne@exemple.test'],
      })
      .returning();
    await db.insert(rdvContacts).values({ instanceId, rendezVousId: r1!.id, contactId: c!.id });
    await db.insert(rdvAffaires).values({ instanceId, rendezVousId: r1!.id, opportuniteId: a!.id });
    const [r2] = await db
      .insert(rendezVous)
      .values({
        instanceId,
        eventId: `evt-fictif-${randomUUID()}`,
        titre: 'Rendez-vous personnel',
        statut: 'ignore',
        debut: new Date('2026-11-06T09:00:00Z'),
      })
      .returning();
    const [n] = await db
      .insert(activites)
      .values({
        instanceId,
        type: 'note',
        resume: 'Note fictive',
        at: new Date('2026-10-20T08:00:00Z'),
        opportuniteId: a!.id,
      })
      .returning();
    return { E1: e!.id, C1: c!.id, A1: a!.id, T1: tache!.id, R1: r1!.id, R2: r2!.id, N1: n!.id };
  }

  const rejoindre = async (slug: string) => {
    const { lien } = await alpes.inviter();
    const res = await app.inject({
      method: 'POST',
      url: `/api/i/${slug}/partenaires/rejoindre`,
      payload: { lien },
    });
    expect(res.statusCode).toBe(200);
    return (await loadInstanceSecrets(secretsDir, slug)).RELAIS_NOEUD ?? '';
  };

  beforeAll(async () => {
    t = await setupTestApp();
    secretsDir = await mkdtemp(path.join(tmpdir(), 'simatis-synchro-'));
    client = await createInstance(t.owner.db, {
      slug: 'client-fictif',
      nom: 'Client fictif',
      type: 'mandat',
      config: { ecrituresReelles: true },
    });
    autre = await createInstance(t.owner.db, {
      slug: 'autre-client',
      nom: 'Autre client',
      type: 'mandat',
      config: { ecrituresReelles: true },
    });
    Object.assign(ids, await seed(client));
    await owner()
      .insert(entreprises)
      .values({ instanceId: autre.id, nom: 'Autre entreprise fictive' });
    relais = relaisSimule();
    deps = { url: relais.url, secretsDir, realWrites: true, fetch: relais.fetch };
    app = buildApp({
      pool: t.app.pool,
      db: t.app.db,
      version: 'test',
      secretsDir,
      realWrites: true,
      relais: { url: relais.url, fetch: relais.fetch },
    });
    alpes = creerClient({ url: relais.url, fetch: relais.fetch });
    alpesNoeud = (await alpes.inscrire({ nom: 'Alpes OS · Essai', cle_inscription: 'cle-de-test' }))
      .id;
    noeud = await rejoindre('client-fictif');
    await lotsAlpes();
  });

  afterAll(async () => {
    await app.close();
    await rm(secretsDir, { recursive: true, force: true });
    await t.drop();
  });

  it('sends the whole follow-up of the client instance first, and nothing of another one', async () => {
    const bilan = await tour();
    expect(bilan.synchronises).toBeGreaterThan(0);
    const lots = await lotsAlpes();
    expect(lots.every((l) => l.instantane !== null)).toBe(true);
    const recus = lots.flatMap((l) => l.changements);
    expect(recus.map((c) => c.objet)).toEqual([
      'pipeline',
      'entreprise',
      'contact',
      'affaire',
      'tache',
      'rendez_vous',
      'activite',
    ]);
    const parRef = new Map(recus.map((c) => [c.ref, c]));
    expect(parRef.get(ref(ids.C1))).toMatchObject({
      champs: {
        nom: 'Jeanne Exemple',
        email: 'jeanne@exemple.test',
        emails: ['j.exemple@exemple.test'],
        telephone: '+33 6 00 00 00 00',
      },
      liens: { entreprises: [ref(ids.E1)] },
    });
    const a = parRef.get(ref(ids.A1));
    expect(a?.champs).toMatchObject({
      titre: 'Diagnostic fictif',
      etape: 'qualification',
      montant: 9000,
      echeance: '2026-12-15',
    });
    // The qualification is Marc's: not shared by default.
    expect(a?.champs).not.toHaveProperty('qualification');
    expect(a?.champs).not.toHaveProperty('potentiel');
    expect(parRef.get(ref(ids.R1))).toMatchObject({
      champs: { titre: 'Premier rendez-vous' },
      liens: { contacts: [ref(ids.C1)], affaires: [ref(ids.A1)] },
    });
    // A meeting that is not a commercial one never leaves; nor does another client's record.
    expect(parRef.has(ref(ids.R2))).toBe(false);
    const texte = JSON.stringify(recus);
    expect(texte).not.toContain('Autre entreprise fictive');
    expect(texte).not.toContain('evt-fictif');
    expect(texte).not.toContain('participants');
    // Nothing changed: the next pass sends nothing.
    await tour();
    expect(await recusAlpes()).toEqual([]);
  });

  it('sends a stage change of Marc alone, once', async () => {
    await owner()
      .update(opportunites)
      .set({ etape: 'proposition' })
      .where(eq(opportunites.id, ids.A1));
    await tour();
    expect(await recusAlpes()).toEqual([
      expect.objectContaining({
        objet: 'affaire',
        ref: ref(ids.A1),
        action: 'maj',
        champs: { etape: 'proposition' },
        liens: {},
      }),
    ]);
    await tour();
    expect(await recusAlpes()).toEqual([]);
  });

  it('never sends an excluded field nor an unchecked object; shares the qualification when Marc decides', async () => {
    const p = await connexion();
    const regler = (voit: unknown) =>
      app.inject({
        method: 'PATCH',
        url: `/api/i/client-fictif/partenaires/${p.id}`,
        payload: { voit },
      });
    await regler({
      objets: ['entreprise', 'contact', 'affaire', 'rendez_vous', 'activite'],
      champsExclus: ['contact.telephone'],
      qualification: true,
    });
    await tour();
    const qualif = await recusAlpes();
    expect(qualif).toEqual([
      expect.objectContaining({
        ref: ref(ids.A1),
        champs: {
          qualification: { besoin: 3, decideur: 2, budget: 2, timing: 1, engagement: 2 },
          potentiel: 'fort',
        },
      }),
    ]);
    await owner()
      .update(contacts)
      .set({ telephone: '+33 6 11 11 11 11' })
      .where(eq(contacts.id, ids.C1));
    await owner()
      .update(taches)
      .set({ titre: 'Rappeler Jeanne demain' })
      .where(eq(taches.id, ids.T1));
    await tour();
    expect(await recusAlpes()).toEqual([]);
    await regler({
      objets: ['entreprise', 'contact', 'affaire', 'tache', 'rendez_vous', 'activite'],
      champsExclus: ['contact.telephone'],
      qualification: true,
    });
    await tour();
    expect(await recusAlpes()).toEqual([
      expect.objectContaining({ objet: 'tache', champs: { titre: 'Rappeler Jeanne demain' } }),
    ]);
  });

  it('applies Christophe’s compte rendu, stage and new records here, without sending them back', async () => {
    const contactAlpes = reference(alpesNoeud, randomUUID());
    await envoyerAlpes([
      changement({
        objet: 'affaire',
        ref: ref(ids.A1),
        modifie_le: dans(1),
        champs: { etape: 'negociation' },
      }),
      changement({
        objet: 'rendez_vous',
        ref: ref(ids.R1),
        modifie_le: dans(1),
        champs: { compte_rendu: 'Compte rendu fictif de l’atelier.', compte_rendu_at: dans(1) },
      }),
      changement({
        objet: 'contact',
        ref: contactAlpes,
        modifie_le: dans(1),
        champs: { nom: 'Paul Fictif', fonction: 'Associé', email: 'paul@exemple.test' },
        liens: { entreprises: [ref(ids.E1)] },
      }),
      changement({
        objet: 'activite',
        ref: reference(alpesNoeud, randomUUID()),
        modifie_le: dans(1),
        champs: { type: 'note', at: dans(1), resume: 'Note de Christophe, fictive.' },
        liens: { affaire: ref(ids.A1), contact: contactAlpes },
      }),
    ]);
    await tour();
    expect((await affaire()).etape).toBe('negociation');
    const rdv = await ligne(() =>
      owner().select().from(rendezVous).where(eq(rendezVous.id, ids.R1)),
    );
    expect(rdv.compteRendu).toBe('Compte rendu fictif de l’atelier.');
    const paul = await ligne(() =>
      owner()
        .select()
        .from(contacts)
        .where(and(eq(contacts.instanceId, client.id), eq(contacts.nom, 'Paul Fictif'))),
    );
    expect(paul).toMatchObject({
      entrepriseId: ids.E1,
      source: `partenaire:${(await connexion()).connexionId}`,
      sourceId: contactAlpes,
    });
    const note = await ligne(() =>
      owner()
        .select()
        .from(activites)
        .where(
          and(
            eq(activites.instanceId, client.id),
            eq(activites.resume, 'Note de Christophe, fictive.'),
          ),
        ),
    );
    expect(note).toMatchObject({ opportuniteId: ids.A1, contactId: paul.id });
    // No echo: what came from Alpes OS does not go back.
    await tour();
    expect(await recusAlpes()).toEqual([]);

    // Marc then changes the contact Christophe created: it goes back under Christophe's reference.
    await owner().update(contacts).set({ fonction: 'Directeur' }).where(eq(contacts.id, paul.id));
    await tour();
    expect(await recusAlpes()).toEqual([
      expect.objectContaining({ ref: contactAlpes, champs: { fonction: 'Directeur' } }),
    ]);
  });

  it('keeps the most recent value when the same field changed on both sides, and says so', async () => {
    const avant = (await sujetsPartenaire()).length;
    await owner().update(opportunites).set({ montant: 11000 }).where(eq(opportunites.id, ids.A1));
    // Christophe's change is older than Marc's: Marc's value stays, and leaves at the next pass.
    await envoyerAlpes([
      changement({
        objet: 'affaire',
        ref: ref(ids.A1),
        modifie_le: dans(-3600),
        champs: { montant: 12000 },
      }),
    ]);
    await tour();
    expect((await affaire()).montant).toBe(11000);
    expect(await recusAlpes()).toEqual([expect.objectContaining({ champs: { montant: 11000 } })]);
    const [conflit] = (await sujetsPartenaire()).slice(avant);
    expect(conflit).toMatchObject({
      titre: 'Modifiée des deux côtés avec Alpes OS : affaire « Diagnostic fictif »',
      resume: expect.stringContaining(
        '« 11000 » gardée (ici, la plus récente) ; « 12000 » écartée.',
      ) as unknown,
    });

    // Christophe's change is newer: it wins here too.
    await owner()
      .update(opportunites)
      .set({ prochaineEtape: 'Envoyer le devis fictif' })
      .where(eq(opportunites.id, ids.A1));
    await envoyerAlpes([
      changement({
        objet: 'affaire',
        ref: ref(ids.A1),
        modifie_le: dans(3600),
        champs: { prochaine_etape: 'Appeler Jeanne' },
      }),
    ]);
    await tour();
    expect((await affaire()).prochaineEtape).toBe('Appeler Jeanne');
    expect(await recusAlpes()).toEqual([]);
    expect((await sujetsPartenaire()).at(-1)?.resume).toContain(
      '« Appeler Jeanne » gardée (Alpes OS, la plus récente)',
    );
  });

  it('turns a deletion into a question, and tells the partner of one made here', async () => {
    await envoyerAlpes([changement({ objet: 'activite', ref: ref(ids.N1), action: 'supprime' })]);
    await tour();
    // Never deleted alone: still here, out of the share, and Marc is asked.
    expect(await owner().select().from(activites).where(eq(activites.id, ids.N1))).toHaveLength(1);
    const [partage] = await owner()
      .select()
      .from(crmPartages)
      .where(eq(crmPartages.localId, ids.N1));
    expect(partage?.detacheAt).toBeTruthy();
    const [question] = await withInstance(t.app.db, client.id, (tx) =>
      tx.select().from(propositions).where(eq(propositions.type, 'partenaire.suppression')),
    );
    expect(question).toMatchObject({ statut: 'proposee', niveau: 'L1' });
    expect((question?.contenu as { titre: string }).titre).toBe(
      'Activité « note » supprimée chez Alpes OS : la supprimer ici aussi ?',
    );
    await withInstance(t.app.db, client.id, (tx) =>
      decide(tx, { instance: client, realWrites: true, secretsDir }, question?.id ?? '', {
        decision: 'valider',
        par: 'pilote',
      }),
    );
    expect(await owner().select().from(activites).where(eq(activites.id, ids.N1))).toHaveLength(0);

    await owner().delete(taches).where(eq(taches.id, ids.T1));
    await tour();
    expect(await recusAlpes()).toEqual([
      expect.objectContaining({ objet: 'tache', ref: ref(ids.T1), action: 'supprime' }),
    ]);
  });

  it('catches up in order, once, after being off', async () => {
    await envoyerAlpes([
      changement({
        objet: 'affaire',
        ref: ref(ids.A1),
        modifie_le: dans(7200),
        champs: { origine: 'Salon fictif' },
      }),
    ]);
    await envoyerAlpes([
      changement({
        objet: 'affaire',
        ref: ref(ids.A1),
        modifie_le: dans(7201),
        champs: { origine: 'Réseau fictif' },
      }),
    ]);
    relais.panne = true;
    await expect(tour()).rejects.toThrow();
    relais.panne = false;
    const bilan = await tour();
    expect(bilan.traitees).toBe(2);
    expect((await affaire()).origine).toBe('Réseau fictif');
    expect((await tour()).traitees).toBe(0);
    expect(await recusAlpes()).toEqual([]);
  });

  it('applies the rest of a batch when the database refuses one change, once', async () => {
    const p = await connexion();
    const bloquee = reference(alpesNoeud, randomUUID());
    // A record already holds this source: the creation is refused.
    await owner()
      .insert(entreprises)
      .values({
        instanceId: client.id,
        nom: 'Doublon fictif',
        source: `partenaire:${p.connexionId}`,
        sourceId: bloquee,
      });
    await envoyerAlpes([
      changement({
        objet: 'entreprise',
        ref: bloquee,
        modifie_le: dans(1),
        champs: { nom: 'Refusée' },
      }),
      changement({
        objet: 'affaire',
        ref: ref(ids.A1),
        modifie_le: dans(9000),
        champs: { origine: 'Après le refus' },
      }),
    ]);
    expect((await tour()).traitees).toBe(1);
    expect((await affaire()).origine).toBe('Après le refus');
    expect((await tour()).traitees).toBe(0);
    await lotsAlpes();
  });

  it('sends nothing while real writes are closed, and shows no partner data to another instance', async () => {
    await owner()
      .update(opportunites)
      .set({ motif: 'Motif fictif' })
      .where(eq(opportunites.id, ids.A1));
    const p = await connexion();
    const bilan = await withInstance(t.app.db, client.id, (tx) =>
      synchroniser(tx, { ...client, config: {} }, p, noeud, true),
    );
    expect(bilan).toBeNull();
    expect(await recusAlpes()).toEqual([]);
    expect(await withInstance(t.app.db, autre.id, (tx) => tx.select().from(crmPartages))).toEqual(
      [],
    );
  });

  it('writes Christophe’s change of a HubSpot deal to HubSpot, under the double lock', async () => {
    const portal = fakePortal(demoPortal());
    const hub = await createInstance(t.owner.db, {
      slug: 'client-hubspot',
      nom: 'Client HubSpot',
      type: 'mandat',
      config: { ecrituresReelles: true },
    });
    await writeFile(
      path.join(secretsDir, 'client-hubspot.env'),
      'HUBSPOT_TOKEN=pat-eu1-fictif-0000\n',
    );
    registerConnector(hubspotConnector({ fetch: portal.fetch, sleep: () => Promise.resolve() }));
    await withInstance(t.app.db, hub.id, (tx) =>
      configureConnexion(tx, {
        kind: 'crm',
        fournisseur: 'hubspot',
        reglages: { sens: 'deux_sens' },
      }),
    );
    await syncConnexion(t.app.db, hub, 'crm', { secretsDir, realWrites: true });
    const noeudHub = await rejoindre('client-hubspot');
    await tourPartenaires(t.app.db, hub, deps);
    await lotsAlpes();
    const [deal] = await owner()
      .select()
      .from(opportunites)
      .where(and(eq(opportunites.instanceId, hub.id), eq(opportunites.sourceId, '301')));
    portal.calls.length = 0;
    const [c] = (await alpes.connexions()).filter(
      (x) => x.partenaire.nom === 'SIMATIS OS · Client HubSpot',
    );
    await alpes.envoyer({
      connexion: c?.id ?? '',
      type: 'donnee',
      corps: lot({
        changements: [
          changement({
            objet: 'affaire',
            ref: reference(noeudHub, deal?.id ?? ''),
            modifie_le: dans(1),
            champs: { etape: 'presentationscheduled' },
          }),
        ],
      }),
    });
    await tourPartenaires(t.app.db, hub, deps);
    const [apres] = await owner()
      .select()
      .from(opportunites)
      .where(eq(opportunites.id, deal?.id ?? ''));
    expect(apres?.etape).toBe('presentationscheduled');
    expect(portal.calls.map((x) => [`${x.method} ${x.path}`, x.body])).toEqual([
      ['PATCH /crm/v3/objects/deals/301', { properties: { dealstage: 'presentationscheduled' } }],
    ]);
  });
});
