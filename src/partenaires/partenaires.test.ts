import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  creerClient,
  etat,
  lireMission,
  note,
  relaisSimule,
  type Client,
  type Mission,
} from 'os-agents-relay';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { buildApp } from '../app.js';
import { withInstance } from '../db/context.js';
import { sujets } from '../inbox/schema.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { decide, propose } from '../propositions/service.js';
import { loadInstanceSecrets } from '../secrets.js';
import { tourPartenaires } from './releve.js';
import { donneesEnvoyees, missions, partenaires, relaisSorties } from './schema.js';
import { traiterEnveloppe, type RelaisDeps } from './service.js';
import './types-propositions.js';

// Every name and value below is fictitious.
describe('Partenaires : relais d’agents (brique 1)', () => {
  let t: TestApp;
  let app: FastifyInstance;
  let appFermee: FastifyInstance;
  let secretsDir: string;
  let relais: ReturnType<typeof relaisSimule>;
  let propre: Instance;
  let autre: Instance;
  let alpes: Client;
  let intrus: Client;
  let deps: RelaisDeps;
  // Calls reaching the relay, to prove a closed lock sends nothing.
  let appels: string[];

  const envoyer = (
    client: Client,
    connexion: string,
    type: 'etat' | 'message',
    corps: Record<string, unknown>,
  ) => client.envoyer({ connexion, type, corps });

  const sujetsRelais = () =>
    withInstance(t.app.db, propre.id, (tx) =>
      tx
        .select()
        .from(sujets)
        .where(and(eq(sujets.instanceId, propre.id), eq(sujets.origine, 'partenaire')))
        .orderBy(sujets.createdAt),
    );
  const mission = (id: string) =>
    withInstance(t.app.db, propre.id, async (tx) => {
      const [m] = await tx.select().from(missions).where(eq(missions.id, id));
      if (!m) throw new Error('mission absente');
      return m;
    });
  const partenaireAlpes = () =>
    withInstance(t.app.db, propre.id, async (tx) => {
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
    const ctx = { instance: propre, realWrites: true, secretsDir };
    const proposee = await withInstance(t.app.db, propre.id, (tx) =>
      propose(tx, ctx, {
        type: 'partenaire.mission',
        auteur: 'agent:claude-marc',
        contenu: { partenaireId: p.id, consigne, titre: titre ?? null },
      }),
    );
    expect(proposee.statut).toBe('proposee');
    const decidee = await withInstance(t.app.db, propre.id, (tx) =>
      decide(tx, ctx, proposee.id, { decision: 'valider', par: 'pilote' }),
    );
    expect(decidee.statut).toBe('appliquee');
    return decidee.resultat as { mission: string; etat: string; titre: string };
  };

  // What Alpes OS does: pick up its mailbox and acknowledge.
  const releverAlpes = async () => {
    const { enveloppes } = await alpes.boite();
    if (enveloppes.length) await alpes.acquitter(enveloppes.map((e) => e.id));
    return enveloppes;
  };

  beforeAll(async () => {
    t = await setupTestApp();
    secretsDir = await mkdtemp(path.join(tmpdir(), 'simatis-partenaires-'));
    propre = await createInstance(t.owner.db, {
      slug: 'mon-activite',
      nom: 'Mon activité',
      type: 'propre',
      config: { ecrituresReelles: true },
    });
    autre = await createInstance(t.owner.db, {
      slug: 'mandat-fictif',
      nom: 'Mandat fictif',
      type: 'mandat',
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
      url: '/api/i/mon-activite/partenaires/rejoindre',
      payload: { lien },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toMatch(/Écritures réelles désactivées/);
    expect(appels).toEqual([]);
    expect((await loadInstanceSecrets(secretsDir, 'mon-activite')).RELAIS_NOEUD).toBeUndefined();
  });

  it('refuses to join from an instance that does not carry partners', async () => {
    const { lien } = await alpes.inviter();
    const res = await app.inject({
      method: 'POST',
      url: '/api/i/mandat-fictif/partenaires/rejoindre',
      payload: { lien },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toMatch(/Mon activité/);
  });

  it('joins with the invitation link: node registered, secrets written, partner listed', async () => {
    const { lien } = await alpes.inviter();
    const res = await app.inject({
      method: 'POST',
      url: '/api/i/mon-activite/partenaires/rejoindre',
      payload: { lien },
    });
    expect(res.statusCode).toBe(200);
    const secrets = await loadInstanceSecrets(secretsDir, 'mon-activite');
    expect(secrets.RELAIS_NOEUD).toBeTruthy();
    expect(secrets.RELAIS_SECRET).toBeTruthy();
    expect(
      (relais.noeuds.get(secrets.RELAIS_NOEUD ?? '') as { nom: string } | undefined)?.nom,
    ).toBe('SIMATIS OS · Mon activité');

    // The connection shows on both sides.
    expect((await alpes.connexions()).map((c) => c.partenaire.nom)).toContain(
      'SIMATIS OS · Mon activité',
    );
    const ecran = await app.inject({ method: 'GET', url: '/api/i/mon-activite/partenaires' });
    const corps = ecran.json<{
      partenaires: { nom: string; niveau: string; partage: string[] }[];
    }>();
    expect(corps.partenaires).toEqual([
      expect.objectContaining({ nom: 'Alpes OS · Essai', niveau: 'L0', partage: [] }),
    ]);
    expect(ecran.body).not.toContain(secrets.RELAIS_SECRET);
    // Alpes OS hears of the acceptance.
    expect((await releverAlpes()).map((e) => e.type)).toEqual(['connexion']);
  });

  it('keeps a mission in simulation when real writes are closed: nothing queued, nothing sent', async () => {
    const p = await partenaireAlpes();
    const ctx = { instance: propre, realWrites: false, secretsDir };
    const proposee = await withInstance(t.app.db, propre.id, (tx) =>
      propose(tx, ctx, {
        type: 'partenaire.mission',
        auteur: 'agent:claude-marc',
        contenu: { partenaireId: p.id, consigne: 'Un livre blanc fictif', titre: 'Essai simulé' },
      }),
    );
    const decidee = await withInstance(t.app.db, propre.id, (tx) =>
      decide(tx, ctx, proposee.id, { decision: 'valider', par: 'pilote' }),
    );
    const { mission: id } = decidee.resultat as { mission: string };
    expect((await mission(id)).etat).toBe('simulation');
    const sorties = await withInstance(t.app.db, propre.id, (tx) =>
      tx.select().from(relaisSorties),
    );
    expect(sorties).toEqual([]);
    await tourPartenaires(t.app.db, propre, deps);
    expect(await releverAlpes()).toEqual([]);
  });

  it('sends a mission through the outbox, then brings back the acceptance once', async () => {
    const { mission: id, etat: e } = await confier(
      'Un livre blanc sur un sujet fictif',
      'Livre blanc (essai)',
    );
    expect(e).toBe('submitted');
    expect(await releverAlpes()).toEqual([]);
    await tourPartenaires(t.app.db, propre, deps);
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
      tourPartenaires(t.app.db, propre, { ...deps, fetch: fetchPerte }),
    ).rejects.toThrow();
    const bilan = await tourPartenaires(t.app.db, propre, { ...deps, fetch: fetchNormal });
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
    await tourPartenaires(t.app.db, propre, deps);
    const [recue] = await releverAlpes();
    const connexion = await connexionAlpes();
    const avant = (await sujetsRelais()).length;

    // SIMATIS OS is off: the relay is unreachable from here, Christophe answers anyway.
    relais.panne = true;
    await expect(tourPartenaires(t.app.db, propre, deps)).rejects.toThrow();
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
    await tourPartenaires(t.app.db, propre, deps);
    await tourPartenaires(t.app.db, propre, deps);

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
    await tourPartenaires(t.app.db, propre, deps);
    const close = await mission(id);
    expect(close.etat).toBe('completed');
    expect(close.historique.at(-1)?.etat).toBe('working');
    expect((await sujetsRelais()).slice(avant)).toHaveLength(1);
  });

  it('records a « later » message in the mission history and the Inbox', async () => {
    const { mission: id } = await confier('Une synthèse fictive', 'Synthèse (essai)');
    await tourPartenaires(t.app.db, propre, deps);
    await releverAlpes();
    await envoyer(
      alpes,
      await connexionAlpes(),
      'message',
      note({ texte: 'Reportée à plus tard.', mission: id }),
    );
    await tourPartenaires(t.app.db, propre, deps);
    const m = await mission(id);
    expect(m.dernierMessage).toBe('Reportée à plus tard.');
    expect(m.historique.at(-1)).toMatchObject({ etat: null, message: 'Reportée à plus tard.' });
    expect((await sujetsRelais()).at(-1)?.titre).toBe(
      'Alpes OS : « Synthèse (essai) », Reportée à plus tard.',
    );
  });

  it('ignores a state about this mission coming from another connection', async () => {
    const { mission: id } = await confier('Une note fictive', 'Note (essai)');
    await tourPartenaires(t.app.db, propre, deps);
    await releverAlpes();
    const { lien } = await intrus.inviter();
    const res = await app.inject({
      method: 'POST',
      url: '/api/i/mon-activite/partenaires/rejoindre',
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
    await tourPartenaires(t.app.db, propre, deps);
    expect((await mission(id)).etat).toBe('submitted');
    expect(await sujetsRelais()).toHaveLength(avant);
  });

  it('sends a fact only when the partner is allowed to see it', async () => {
    const p = await partenaireAlpes();
    const ctx = { instance: propre, realWrites: true, secretsDir };
    const contenu = {
      partenaireId: p.id,
      objet: 'affaire' as const,
      evenement: 'cree' as const,
      ref: 'affaire-fictive-1',
      champs: { entreprise: 'Entreprise fictive', ville: 'Villefictive' },
    };
    const valider = async () => {
      const proposee = await withInstance(t.app.db, propre.id, (tx) =>
        propose(tx, ctx, { type: 'partenaire.donnee', auteur: 'agent:claude-marc', contenu }),
      );
      return withInstance(t.app.db, propre.id, (tx) =>
        decide(tx, ctx, proposee.id, { decision: 'valider', par: 'pilote' }),
      );
    };
    const refusee = await valider();
    expect(refusee.statut).toBe('echec');
    expect((refusee.resultat as { erreur: string }).erreur).toMatch(/ne voit pas/);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/i/mon-activite/partenaires/${p.id}`,
      payload: { partage: ['affaire'], niveau: 'L1' },
    });
    expect(patch.json()).toMatchObject({ partenaire: { partage: ['affaire'], niveau: 'L1' } });

    expect((await valider()).statut).toBe('appliquee');
    const traces = await withInstance(t.app.db, propre.id, (tx) =>
      tx.select().from(donneesEnvoyees),
    );
    expect(traces).toEqual([
      expect.objectContaining({ objet: 'affaire', ref: 'affaire-fictive-1' }),
    ]);
    await tourPartenaires(t.app.db, propre, deps);
    const [recue] = await releverAlpes();
    expect(recue).toMatchObject({ id: traces[0]?.id, type: 'donnee' });
  });

  it('marks the partner cut when it cuts, and gives up what was still queued for it', async () => {
    const { mission: id } = await confier('Une dernière mission fictive', 'Dernière (essai)');
    const [c] = (await alpes.connexions()).filter(
      (x) => x.partenaire.nom === 'SIMATIS OS · Mon activité',
    );
    await alpes.couper(c?.id ?? '');
    await tourPartenaires(t.app.db, propre, deps);

    expect((await partenaireAlpes()).statut).toBe('coupee');
    const m = await mission(id);
    expect(m.etat).toBe('failed');
    const titres = (await sujetsRelais()).map((s) => s.titre);
    expect(titres).toContain('Connexion coupée par Alpes OS');
    expect(titres).toContain('Mission non envoyée à Alpes OS : « Dernière (essai) »');
    expect(
      await withInstance(t.app.db, propre.id, (tx) => tx.select().from(relaisSorties)),
    ).toEqual([]);
  });

  it('logs an envelope of brique 2 and acknowledges it without effect', async () => {
    const [c] = await intrus.connexions();
    await intrus.envoyer({
      connexion: c?.id ?? '',
      type: 'mission',
      corps: {
        kind: 'task',
        id: 'x',
        contextId: 'y',
        status: { state: 'submitted', timestamp: 'now' },
        history: [
          {
            kind: 'message',
            messageId: 'm',
            role: 'user',
            parts: [{ kind: 'text', text: 'Fictif' }],
          },
        ],
      },
    });
    const bilan = await tourPartenaires(t.app.db, propre, deps);
    expect(bilan.traitees).toBe(1);
    expect(
      (relais.enveloppes as { a: string }[]).filter((e) => e.a === c?.partenaire.id),
    ).toHaveLength(0);
  });

  it('never shows the partners or missions of one instance to another', async () => {
    const vus = await withInstance(t.app.db, autre.id, async (tx) => ({
      partenaires: await tx.select().from(partenaires),
      missions: await tx.select().from(missions),
    }));
    expect(vus).toEqual({ partenaires: [], missions: [] });
    const ecran = await app.inject({ method: 'GET', url: '/api/i/mandat-fictif/partenaires' });
    expect(ecran.json()).toMatchObject({ porteuse: false, partenaires: [], missions: [] });
    // Nor can it process an envelope into another instance's mission.
    await expect(
      traiterEnveloppe(t.app.db, autre, {
        id: 'env-fictive',
        connexion: await connexionAlpes(),
        de: 'x',
        a: 'y',
        type: 'etat',
        corps: etat({ mission: 'inconnue', etat: 'completed' }),
        cree_le: new Date().toISOString(),
      }),
    ).resolves.toBeUndefined();
  });
});
