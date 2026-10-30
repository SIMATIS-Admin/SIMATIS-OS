import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  creerClient,
  etat,
  lireEtat,
  lireMessageLibre,
  lireMission,
  messageLibre,
  mission as nouvelleMission,
  note,
  relaisSimule,
  type Client,
  type Etat,
  type Message,
  type Mission,
} from 'os-agents-relay';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { buildApp } from '../app.js';
import { withInstance } from '../db/context.js';
import { sujets } from '../inbox/schema.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { propositions } from '../propositions/schema.js';
import { decide, propose } from '../propositions/service.js';
import { loadInstanceSecrets } from '../secrets.js';
import { tourPartenaires } from './releve.js';
import { messagesPartenaires, missions, partenaires, relaisSorties } from './schema.js';
import { traiterEnveloppe, type RelaisDeps } from './service.js';
import './types-propositions.js';

// Every name and value below is fictitious.
describe('Partenaires : relais d’agents (brique 1)', () => {
  let t: TestApp;
  let app: FastifyInstance;
  let appFermee: FastifyInstance;
  let secretsDir: string;
  let relais: ReturnType<typeof relaisSimule>;
  let client: Instance;
  let autre: Instance;
  let alpes: Client;
  let intrus: Client;
  let deps: RelaisDeps;
  // Calls reaching the relay, to prove a closed lock sends nothing.
  let appels: string[];

  const envoyer = (
    client: Client,
    connexion: string,
    type: 'etat' | 'message' | 'mission',
    corps: Record<string, unknown>,
  ) => client.envoyer({ connexion, type, corps });

  const sujetsRelais = () =>
    withInstance(t.app.db, client.id, (tx) =>
      tx
        .select()
        .from(sujets)
        .where(and(eq(sujets.instanceId, client.id), eq(sujets.origine, 'partenaire')))
        .orderBy(sujets.createdAt),
    );
  const mission = (id: string) =>
    withInstance(t.app.db, client.id, async (tx) => {
      const [m] = await tx.select().from(missions).where(eq(missions.id, id));
      if (!m) throw new Error('mission absente');
      return m;
    });
  const partenaireAlpes = () =>
    withInstance(t.app.db, client.id, async (tx) => {
      const [p] = await tx
        .select()
        .from(partenaires)
        .where(eq(partenaires.nom, 'Alpes OS · Essai'));
      if (!p) throw new Error('partenaire absent');
      return p;
    });
  const connexionAlpes = async () => (await partenaireAlpes()).connexionId;

  // Marc entrusts a mission; at L2 it waits in the Inbox until he validates it.
  const confier = async (consigne: string, titre?: string) => {
    const p = await partenaireAlpes();
    const ctx = { instance: client, realWrites: true, secretsDir };
    const proposee = await withInstance(t.app.db, client.id, (tx) =>
      propose(tx, ctx, {
        type: 'partenaire.mission',
        auteur: 'agent:claude-marc',
        contenu: { partenaireId: p.id, consigne, titre: titre ?? null },
      }),
    );
    expect(proposee.statut).toBe('proposee');
    const decidee = await withInstance(t.app.db, client.id, (tx) =>
      decide(tx, ctx, proposee.id, { decision: 'valider', par: 'pilote' }),
    );
    expect(decidee.statut).toBe('appliquee');
    return decidee.resultat as { mission: string; etat: string; titre: string };
  };

  // What Alpes OS does: pick up its mailbox and acknowledge. The CRM sync (synchro.test.ts) is
  // left out here.
  const releverAlpes = async () => {
    const { enveloppes } = await alpes.boite();
    if (enveloppes.length) await alpes.acquitter(enveloppes.map((e) => e.id));
    return enveloppes.filter((e) => e.type !== 'donnee');
  };

  beforeAll(async () => {
    t = await setupTestApp();
    secretsDir = await mkdtemp(path.join(tmpdir(), 'simatis-partenaires-'));
    // The client's instance carries the connection with that client's OS.
    client = await createInstance(t.owner.db, {
      slug: 'client-fictif',
      nom: 'Client fictif',
      type: 'mandat',
      config: { ecrituresReelles: true },
    });
    autre = await createInstance(t.owner.db, {
      slug: 'mon-activite',
      nom: 'Mon activité',
      type: 'propre',
      config: { ecrituresReelles: true },
    });
    relais = relaisSimule();
    appels = [];
    const fetchRelais: typeof fetch = (entree, init) => {
      appels.push(
        `${init?.method ?? 'GET'} ${new URL(entree instanceof Request ? entree.url : entree).pathname}`,
      );
      return relais.fetch(entree, init);
    };
    deps = { url: relais.url, secretsDir, realWrites: true, fetch: fetchRelais };
    app = buildApp({
      pool: t.app.pool,
      db: t.app.db,
      version: 'test',
      secretsDir,
      realWrites: true,
      relais: { url: relais.url, fetch: fetchRelais },
    });
    appFermee = buildApp({
      pool: t.app.pool,
      db: t.app.db,
      version: 'test',
      secretsDir,
      realWrites: false,
      relais: { url: relais.url, fetch: fetchRelais },
    });
    alpes = creerClient({ url: relais.url, fetch: relais.fetch });
    await alpes.inscrire({ nom: 'Alpes OS · Essai', cle_inscription: 'cle-de-test' });
    intrus = creerClient({ url: relais.url, fetch: relais.fetch });
    await intrus.inscrire({ nom: 'Autre OS · Essai', cle_inscription: 'cle-de-test' });
  });

  afterAll(async () => {
    await app.close();
    await appFermee.close();
    await rm(secretsDir, { recursive: true, force: true });
    await t.drop();
  });

  beforeEach(() => {
    relais.panne = false;
  });

  it('refuses to join while real writes are closed, without calling the relay', async () => {
    const { lien } = await alpes.inviter();
    appels = [];
    const res = await appFermee.inject({
      method: 'POST',
      url: '/api/i/client-fictif/partenaires/rejoindre',
      payload: { lien },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toMatch(/Écritures réelles désactivées/);
    expect(appels).toEqual([]);
    expect((await loadInstanceSecrets(secretsDir, 'client-fictif')).RELAIS_NOEUD).toBeUndefined();
  });

  it('refuses to join from an instance that does not carry partners', async () => {
    const { lien } = await alpes.inviter();
    const res = await app.inject({
      method: 'POST',
      url: '/api/i/mon-activite/partenaires/rejoindre',
      payload: { lien },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toMatch(/mandat/);
  });

  it('joins with the invitation link: node registered, secrets written, partner listed', async () => {
    const { lien } = await alpes.inviter();
    const res = await app.inject({
      method: 'POST',
      url: '/api/i/client-fictif/partenaires/rejoindre',
      payload: { lien },
    });
    expect(res.statusCode).toBe(200);
    const secrets = await loadInstanceSecrets(secretsDir, 'client-fictif');
    expect(secrets.RELAIS_NOEUD).toBeTruthy();
    expect(secrets.RELAIS_SECRET).toBeTruthy();
    expect(
      (relais.noeuds.get(secrets.RELAIS_NOEUD ?? '') as { nom: string } | undefined)?.nom,
    ).toBe('SIMATIS OS · Client fictif');

    // The connection shows on both sides.
    expect((await alpes.connexions()).map((c) => c.partenaire.nom)).toContain(
      'SIMATIS OS · Client fictif',
    );
    const ecran = await app.inject({ method: 'GET', url: '/api/i/client-fictif/partenaires' });
    const corps = ecran.json<{
      partenaires: { nom: string; niveau: string; voit: unknown }[];
    }>();
    expect(corps.partenaires).toEqual([
      expect.objectContaining({
        nom: 'Alpes OS · Essai',
        niveau: 'L0',
        voit: {
          objets: ['entreprise', 'contact', 'affaire', 'tache', 'rendez_vous', 'activite'],
          champsExclus: [],
          qualification: false,
        },
      }),
    ]);
    expect(ecran.body).not.toContain(secrets.RELAIS_SECRET);
    // Alpes OS hears of the acceptance.
    expect((await releverAlpes()).map((e) => e.type)).toEqual(['connexion']);
  });

  it('keeps a mission in simulation when real writes are closed: nothing queued, nothing sent', async () => {
    const p = await partenaireAlpes();
    const ctx = { instance: client, realWrites: false, secretsDir };
    const proposee = await withInstance(t.app.db, client.id, (tx) =>
      propose(tx, ctx, {
        type: 'partenaire.mission',
        auteur: 'agent:claude-marc',
        contenu: { partenaireId: p.id, consigne: 'Un livre blanc fictif', titre: 'Essai simulé' },
      }),
    );
    const decidee = await withInstance(t.app.db, client.id, (tx) =>
      decide(tx, ctx, proposee.id, { decision: 'valider', par: 'pilote' }),
    );
    const { mission: id } = decidee.resultat as { mission: string };
    expect((await mission(id)).etat).toBe('simulation');
    const sorties = await withInstance(t.app.db, client.id, (tx) =>
      tx.select().from(relaisSorties),
    );
    expect(sorties).toEqual([]);
    await tourPartenaires(t.app.db, client, deps);
    expect(await releverAlpes()).toEqual([]);
  });

  it('sends a mission through the outbox, then brings back the acceptance once', async () => {
    const { mission: id, etat: e } = await confier(
      'Un livre blanc sur un sujet fictif',
      'Livre blanc (essai)',
    );
    expect(e).toBe('submitted');
    expect(await releverAlpes()).toEqual([]);
    await tourPartenaires(t.app.db, client, deps);
    const [recue] = await releverAlpes();
    expect(recue?.type).toBe('mission');
    const m = recue?.corps as Mission;
    expect(lireMission(m)).toMatchObject({ id, titre: 'Livre blanc (essai)' });

    // Christophe accepts with the retained title. The first acknowledgement is lost: the relay
    // delivers the envelope again, the Inbox still gets one subject.
    const connexion = await connexionAlpes();
    await envoyer(
      alpes,
      connexion,
      'etat',
      etat({
        mission: m,
        etat: 'working',
        message: 'Acceptée : « Livre blanc retenu »',
        resultat: { titre: 'Livre blanc retenu' },
      }),
    );
    const fetchNormal = deps.fetch;
    let perdu = false;
    const fetchPerte: typeof fetch = (entree, init) => {
      if (!perdu && (entree as string).endsWith('/boite/acquitter')) {
        perdu = true;
        return Promise.reject(new TypeError('fetch failed'));
      }
      return relais.fetch(entree, init);
    };
    await expect(
      tourPartenaires(t.app.db, client, { ...deps, fetch: fetchPerte }),
    ).rejects.toThrow();
    const bilan = await tourPartenaires(t.app.db, client, { ...deps, fetch: fetchNormal });
    expect(bilan).toMatchObject({ traitees: 0, doublons: 1 });

    const apres = await mission(id);
    expect(apres.etat).toBe('working');
    expect(apres.resultat).toEqual({ titre: 'Livre blanc retenu' });
    expect(apres.historique.map((h) => h.etat)).toEqual(['submitted', 'working']);
    const s = await sujetsRelais();
    expect(s.map((x) => x.titre)).toEqual(['Alpes OS a accepté « Livre blanc retenu »']);
    expect(s[0]).toMatchObject({ type: 'autre', source: 'relais', priorite: 3 });
  });

  it('picks up a state sent while SIMATIS OS was off at the next start, once', async () => {
    const { mission: id } = await confier('Une étude fictive', 'Étude (essai)');
    await tourPartenaires(t.app.db, client, deps);
    const [recue] = await releverAlpes();
    const connexion = await connexionAlpes();
    const avant = (await sujetsRelais()).length;

    // SIMATIS OS is off: the relay is unreachable from here, Christophe answers anyway.
    relais.panne = true;
    await expect(tourPartenaires(t.app.db, client, deps)).rejects.toThrow();
    relais.panne = false;
    await envoyer(
      alpes,
      connexion,
      'etat',
      etat({
        mission: recue?.corps as Mission,
        etat: 'completed',
        message: 'Voici le document.',
        resultat: { titre: 'Étude (essai)', lien: 'https://exemple.test/etude' },
      }),
    );
    await tourPartenaires(t.app.db, client, deps);
    await tourPartenaires(t.app.db, client, deps);

    expect((await mission(id)).etat).toBe('completed');
    const nouveaux = (await sujetsRelais()).slice(avant);
    expect(nouveaux).toHaveLength(1);
    expect(nouveaux[0]).toMatchObject({
      titre: 'Alpes OS : mission faite, « Étude (essai) »',
      lien: 'https://exemple.test/etude',
      priorite: 4,
    });

    // A late non-final state never reopens a closed mission.
    await envoyer(
      alpes,
      connexion,
      'etat',
      etat({ mission: id, etat: 'working', message: 'En cours.' }),
    );
    await tourPartenaires(t.app.db, client, deps);
    const close = await mission(id);
    expect(close.etat).toBe('completed');
    expect(close.historique.at(-1)?.etat).toBe('working');
    expect((await sujetsRelais()).slice(avant)).toHaveLength(1);
  });

  it('records a « later » message in the mission history and the Inbox', async () => {
    const { mission: id } = await confier('Une synthèse fictive', 'Synthèse (essai)');
    await tourPartenaires(t.app.db, client, deps);
    await releverAlpes();
    await envoyer(
      alpes,
      await connexionAlpes(),
      'message',
      note({ texte: 'Reportée à plus tard.', mission: id }),
    );
    await tourPartenaires(t.app.db, client, deps);
    const m = await mission(id);
    expect(m.dernierMessage).toBe('Reportée à plus tard.');
    expect(m.historique.at(-1)).toMatchObject({ etat: null, message: 'Reportée à plus tard.' });
    expect((await sujetsRelais()).at(-1)?.titre).toBe(
      'Alpes OS : « Synthèse (essai) », Reportée à plus tard.',
    );
  });

  it('ignores a state about this mission coming from another connection', async () => {
    const { mission: id } = await confier('Une note fictive', 'Note (essai)');
    await tourPartenaires(t.app.db, client, deps);
    await releverAlpes();
    const { lien } = await intrus.inviter();
    const res = await app.inject({
      method: 'POST',
      url: '/api/i/client-fictif/partenaires/rejoindre',
      payload: { lien },
    });
    expect(res.statusCode).toBe(200);
    const [c] = await intrus.connexions();
    const avant = (await sujetsRelais()).length;
    await envoyer(
      intrus,
      c?.id ?? '',
      'etat',
      etat({ mission: id, etat: 'rejected', message: 'Non.' }),
    );
    await tourPartenaires(t.app.db, client, deps);
    expect((await mission(id)).etat).toBe('submitted');
    expect(await sujetsRelais()).toHaveLength(avant);
  });

  it('sets what the partner sees and its level for received missions', async () => {
    const p = await partenaireAlpes();
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/i/client-fictif/partenaires/${p.id}`,
      payload: {
        niveau: 'L1',
        voit: {
          objets: ['entreprise', 'contact', 'affaire'],
          champsExclus: ['contact.telephone', 'affaire.montant'],
          qualification: true,
        },
      },
    });
    expect(patch.json()).toMatchObject({
      partenaire: {
        niveau: 'L1',
        voit: {
          objets: ['entreprise', 'contact', 'affaire'],
          champsExclus: ['contact.telephone', 'affaire.montant'],
          qualification: true,
        },
      },
    });
    // An internal field is not a setting.
    const interne = await app.inject({
      method: 'PATCH',
      url: `/api/i/client-fictif/partenaires/${p.id}`,
      payload: { voit: { objets: [], champsExclus: ['contact.source_id'], qualification: false } },
    });
    expect(interne.statusCode).toBe(400);
    await app.inject({
      method: 'PATCH',
      url: `/api/i/client-fictif/partenaires/${p.id}`,
      payload: { niveau: 'L0' },
    });
  });

  // Alpes OS entrusts a mission to Marc; what happens depends on the level Marc set.
  const recevoirMission = async (niveau: 'L0' | 'L1' | 'L2' | 'L3', consigne: string) => {
    const p = await partenaireAlpes();
    await app.inject({
      method: 'PATCH',
      url: `/api/i/client-fictif/partenaires/${p.id}`,
      payload: { niveau },
    });
    const m = nouvelleMission({ consigne, titre: `${consigne} (${niveau})` });
    await envoyer(alpes, p.connexionId, 'mission', m);
    await tourPartenaires(t.app.db, client, deps);
    return m;
  };
  const etatsRecus = async (id: string) =>
    (await releverAlpes())
      .filter((e) => e.type === 'etat' && (e.corps as { taskId: string }).taskId === id)
      .map((e) => lireEtat(e.corps as Etat).etat);
  const propositionDe = async (missionId: string) => {
    const [p] = await withInstance(t.app.db, client.id, (tx) =>
      tx
        .select()
        .from(propositions)
        .where(sql`${propositions.contenu} ->> 'missionId' = ${missionId}`),
    );
    if (!p) throw new Error('proposition absente');
    return p;
  };
  const ctxReel = () => ({ instance: client, realWrites: true, secretsDir });

  it('turns a mission received at L0 into a proposal of the Inbox, accepted by Marc', async () => {
    const m = await recevoirMission('L0', 'Un rendez-vous fictif à préparer');
    expect(await mission(m.id)).toMatchObject({
      sens: 'recue',
      etat: 'submitted',
      niveau: 'L0',
      titre: 'Un rendez-vous fictif à préparer (L0)',
    });
    // Nothing goes back before Marc decides.
    expect(await etatsRecus(m.id)).toEqual([]);
    const p = await propositionDe(m.id);
    expect(p).toMatchObject({ type: 'partenaire.mission_recue', statut: 'proposee', niveau: 'L0' });
    const [sujet] = await withInstance(t.app.db, client.id, (tx) =>
      tx.select().from(sujets).where(eq(sujets.propositionId, p.id)),
    );
    expect(sujet?.titre).toBe('Alpes OS vous confie « Un rendez-vous fictif à préparer (L0) »');

    await withInstance(t.app.db, client.id, (tx) =>
      decide(tx, ctxReel(), p.id, { decision: 'valider', par: 'pilote' }),
    );
    expect((await mission(m.id)).etat).toBe('working');
    await tourPartenaires(t.app.db, client, deps);
    expect(await etatsRecus(m.id)).toEqual(['working']);
  });

  it('tells the partner when Marc refuses a mission received at L1', async () => {
    const m = await recevoirMission('L1', 'Une relance fictive');
    const p = await propositionDe(m.id);
    expect(p.niveau).toBe('L1');
    await withInstance(t.app.db, client.id, (tx) =>
      decide(tx, ctxReel(), p.id, { decision: 'ecarter', par: 'pilote' }),
    );
    expect((await mission(m.id)).etat).toBe('rejected');
    await tourPartenaires(t.app.db, client, deps);
    expect(await etatsRecus(m.id)).toEqual(['rejected']);
  });

  it('takes a mission in hand at L2, then sends the answer once Marc validates it', async () => {
    const m = await recevoirMission('L2', 'Une synthèse fictive à préparer');
    expect((await mission(m.id)).etat).toBe('working');
    expect((await sujetsRelais()).at(-1)).toMatchObject({
      titre: 'Alpes OS vous confie « Une synthèse fictive à préparer (L2) »',
      resume: expect.stringContaining('attendra votre validation') as unknown,
    });
    await tourPartenaires(t.app.db, client, deps);
    expect(await etatsRecus(m.id)).toEqual(['working']);

    const proposee = await withInstance(t.app.db, client.id, (tx) =>
      propose(tx, ctxReel(), {
        type: 'partenaire.reponse',
        auteur: 'agent:claude-marc',
        niveau: 'L2',
        contenu: {
          missionId: m.id,
          titre: 'Répondre à Alpes OS',
          etat: 'completed',
          message: 'Voici la synthèse fictive.',
          resultat: { lien: 'https://exemple.test/synthese' },
        },
      }),
    );
    expect(proposee.statut).toBe('proposee');
    await tourPartenaires(t.app.db, client, deps);
    expect(await etatsRecus(m.id)).toEqual([]);
    await withInstance(t.app.db, client.id, (tx) =>
      decide(tx, ctxReel(), proposee.id, { decision: 'valider', par: 'pilote' }),
    );
    await tourPartenaires(t.app.db, client, deps);
    const [fait] = (await releverAlpes()).filter((e) => e.type === 'etat');
    expect(lireEtat(fait?.corps as Etat)).toMatchObject({
      mission: m.id,
      etat: 'completed',
      message: 'Voici la synthèse fictive.',
      resultat: { lien: 'https://exemple.test/synthese' },
    });
  });

  it('lets the agent work alone at L3, and keeps a refused send in simulation when writes close', async () => {
    const m = await recevoirMission('L3', 'Une note fictive');
    expect((await mission(m.id)).etat).toBe('working');
    expect((await sujetsRelais()).at(-1)?.resume).toMatch(/L’agent la fait seul/);
    await tourPartenaires(t.app.db, client, deps);
    expect(await etatsRecus(m.id)).toEqual(['working']);
    // Real writes closed: the answer is recorded, nothing leaves.
    const fermee = await withInstance(t.app.db, client.id, (tx) =>
      propose(
        tx,
        { ...ctxReel(), realWrites: false },
        {
          type: 'partenaire.reponse',
          auteur: 'agent:claude-marc',
          niveau: 'L3',
          contenu: { missionId: m.id, titre: 'x', etat: 'completed', message: 'Fait.' },
        },
      ),
    );
    expect(fermee).toMatchObject({ statut: 'appliquee' });
    expect((await mission(m.id)).historique.at(-1)?.message).toMatch(/Simulation/);
    await tourPartenaires(t.app.db, client, deps);
    expect(await etatsRecus(m.id)).toEqual([]);
  });

  it('turns a free message into an Inbox subject, and sends one back', async () => {
    const p = await partenaireAlpes();
    const question = messageLibre({
      type: 'question',
      sujet: 'Atelier fictif de jeudi',
      texte: 'Le **compte rendu** est ici : https://exemple.test/cr. Qu’en penses-tu ?',
    });
    await envoyer(alpes, p.connexionId, 'message', question);
    await tourPartenaires(t.app.db, client, deps);
    expect((await sujetsRelais()).at(-1)).toMatchObject({
      titre: 'Alpes OS demande : Atelier fictif de jeudi',
      resume: expect.stringContaining('**compte rendu**') as unknown,
      priorite: 4,
    });

    const reponse = await withInstance(t.app.db, client.id, (tx) =>
      propose(tx, ctxReel(), {
        type: 'partenaire.message',
        auteur: 'agent:claude-marc',
        contenu: {
          partenaireId: p.id,
          type: 'reponse',
          sujet: 'Re : atelier fictif',
          texte: 'Très bien, *merci*.',
          enReponseA: question.messageId,
        },
      }),
    );
    await withInstance(t.app.db, client.id, (tx) =>
      decide(tx, ctxReel(), reponse.id, { decision: 'valider', par: 'pilote' }),
    );
    await tourPartenaires(t.app.db, client, deps);
    const [recu] = (await releverAlpes()).filter((e) => e.type === 'message');
    expect(lireMessageLibre(recu?.corps as Message)).toMatchObject({
      type: 'reponse',
      sujet: 'Re : atelier fictif',
      texte: 'Très bien, *merci*.',
      en_reponse_a: question.messageId,
    });
    const traces = await withInstance(t.app.db, client.id, (tx) =>
      tx.select().from(messagesPartenaires).orderBy(messagesPartenaires.createdAt),
    );
    expect(traces.map((m) => [m.sens, m.type])).toEqual([
      ['recu', 'question'],
      ['envoye', 'reponse'],
    ]);
  });

  it('marks the partner cut when it cuts, and gives up what was still queued for it', async () => {
    const { mission: id } = await confier('Une dernière mission fictive', 'Dernière (essai)');
    const [c] = (await alpes.connexions()).filter(
      (x) => x.partenaire.nom === 'SIMATIS OS · Client fictif',
    );
    await alpes.couper(c?.id ?? '');
    await tourPartenaires(t.app.db, client, deps);

    expect((await partenaireAlpes()).statut).toBe('coupee');
    const m = await mission(id);
    expect(m.etat).toBe('failed');
    const titres = (await sujetsRelais()).map((s) => s.titre);
    expect(titres).toContain('Connexion coupée par Alpes OS');
    expect(titres).toContain('Mission non envoyée à Alpes OS : « Dernière (essai) »');
    expect(
      await withInstance(t.app.db, client.id, (tx) => tx.select().from(relaisSorties)),
    ).toEqual([]);
  });

  it('never shows the partners or missions of one instance to another', async () => {
    const vus = await withInstance(t.app.db, autre.id, async (tx) => ({
      partenaires: await tx.select().from(partenaires),
      missions: await tx.select().from(missions),
    }));
    expect(vus).toEqual({ partenaires: [], missions: [] });
    const ecran = await app.inject({ method: 'GET', url: '/api/i/mon-activite/partenaires' });
    expect(ecran.json()).toMatchObject({ porteuse: false, partenaires: [], missions: [] });
    // Nor can it process an envelope into another instance's mission.
    await expect(
      traiterEnveloppe(
        t.app.db,
        autre,
        {
          id: 'env-fictive',
          connexion: await connexionAlpes(),
          de: 'x',
          a: 'y',
          type: 'etat',
          corps: etat({ mission: 'inconnue', etat: 'completed' }),
          cree_le: new Date().toISOString(),
        },
        deps,
      ),
    ).resolves.toBeUndefined();
  });
});
