import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { activites, contacts, entreprises } from '../crm/schema.js';
import { hubspotConnector } from '../connecteurs/hubspot/index.js';
import { configureConnexion, registerConnector } from '../connexions/service.js';
import { demoPortal, fakePortal } from '../../test/hubspot-portal.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { toolsFor, type ToolCtx } from '../mcp/tools.js';
import { integrerFiches, majConformite, majHistorique } from './integration.js';
import { normaliserFiche, type Brut } from './nettoyage.js';
import './outils-mcp.js';
import {
  ClasseRefusee,
  proposerClasse,
  ReponseIntrouvable,
  reponsesAClasser,
  reponsesAValider,
  validerReponse,
} from './reponses.js';
import { baseReponses } from './schema.js';
import { creerImports, listerFiches } from './service.js';
import { entrerDansCrm, entrerRepondants } from './vers-crm.js';

describe('base vivante : réponses, entrée dans le CRM, outils de la routine', () => {
  let t: TestApp;
  let base: Instance;
  let mandat: Instance;
  let hubspot: Instance;
  let secretsDir: string;
  const deps = () => ({ secretsDir, realWrites: false });

  beforeAll(async () => {
    t = await setupTestApp();
    base = await createInstance(t.owner.db, { slug: 'bv-l3-base', nom: 'Base', type: 'propre' });
    mandat = await createInstance(t.owner.db, {
      slug: 'bv-l3-mandat',
      nom: 'Mandat Fictif',
      type: 'mandat',
    });
    hubspot = await createInstance(t.owner.db, {
      slug: 'bv-l3-hub',
      nom: 'Mandat HubSpot',
      type: 'mandat',
    });
    secretsDir = await mkdtemp(path.join(tmpdir(), 'bv-l3-'));
    await writeFile(path.join(secretsDir, 'bv-l3-hub.env'), 'HUBSPOT_TOKEN=pat-eu1-fictif-0000\n');
    registerConnector(
      hubspotConnector({ fetch: fakePortal(demoPortal()).fetch, sleep: () => Promise.resolve() }),
    );
    await withInstance(t.owner.db, hubspot.id, (tx) =>
      configureConnexion(tx, {
        kind: 'crm',
        fournisseur: 'hubspot',
        reglages: { sens: 'deux_sens' },
      }),
    );
  });
  afterAll(async () => {
    await t.drop();
    await rm(secretsDir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    for (const table of [
      'base_reponses',
      'base_lignes_brutes',
      'base_vivante',
      'base_imports',
      'base_correspondances',
      'activites',
      'contacts',
      'entreprises',
    ])
      await t.owner.pool.query(`delete from ${table}`);
  });

  const integrer = async (...brutes: (Brut & { mandat?: string })[]) => {
    const ids = await withInstance(t.app.db, base.id, (tx) =>
      integrerFiches(
        tx,
        base.id,
        brutes.map((b) => ({
          fiche: normaliserFiche(b).fiche,
          provenance: 'Sharp',
          mandat: null,
          importId: null,
          collecteLe: null,
        })),
      ),
    );
    return ids.map((i) => i.id);
  };
  const aRepondu = (id: string, nomMandat = 'Mandat Fictif') =>
    withInstance(t.app.db, base.id, (tx) =>
      majHistorique(tx, base.id, id, {
        dernierContactLe: new Date('2026-09-12T09:00:00Z'),
        dernierContactCanal: 'email',
        mandatContacteur: nomMandat,
        nbContacts: 1,
        resultat: 'repondu',
      }),
    );
  const reponse = async (
    ficheId: string,
    extra: Partial<typeof baseReponses.$inferInsert> = {},
  ) => {
    const [r] = await t.owner.db
      .insert(baseReponses)
      .values({
        instanceId: base.id,
        ficheId,
        mandat: 'Mandat Fictif',
        messageId: `m-${Math.random()}`,
        recuLe: new Date('2026-09-12T09:00:00Z'),
        objet: 'Re: Proposition',
        extrait: 'Merci, pas pour le moment.',
        ...extra,
      })
      .returning();
    return r?.id ?? '';
  };
  const fiche = async (id: string) =>
    (await listerFiches(t.app.db, base.id, { limite: 50 })).fiches.find((f) => f.id === id);

  describe('classement des réponses', () => {
    it('Claude propose, la fiche ne bouge qu’à la validation du pilote', async () => {
      const [id] = await integrer({ entreprise: 'A Fictif', nom: 'Un', email: 'un@a.test' });
      const r = await reponse(id ?? '');
      expect((await reponsesAClasser(t.app.db, base.id)).map((x) => x.id)).toEqual([r]);
      await proposerClasse(t.app.db, base.id, r, 'interesse');
      expect(await reponsesAClasser(t.app.db, base.id)).toEqual([]);
      expect((await reponsesAValider(t.app.db, base.id))[0]).toMatchObject({
        classe: 'interesse',
        entreprise: 'A Fictif',
        contact: 'UN',
      });
      expect((await fiche(id ?? ''))?.resultat).toBeNull();
      await validerReponse(t.app.db, base.id, r);
      expect(await fiche(id ?? '')).toMatchObject({
        resultat: 'interesse',
        statutProspection: 'a_repondu',
      });
      expect(await reponsesAValider(t.app.db, base.id)).toEqual([]);
      await expect(validerReponse(t.app.db, base.id, r)).rejects.toThrow(ReponseIntrouvable);
      await expect(proposerClasse(t.app.db, base.id, r, 'repondu')).rejects.toThrow(
        ReponseIntrouvable,
      );
    });

    it('le pilote peut changer la classe proposée', async () => {
      const [id] = await integrer({ entreprise: 'A Fictif', nom: 'Un', email: 'un@a.test' });
      const r = await reponse(id ?? '', { classe: 'interesse' });
      await validerReponse(t.app.db, base.id, r, 'mauvais_interlocuteur');
      expect((await fiche(id ?? ''))?.resultat).toBe('mauvais_interlocuteur');
    });

    it('« ne plus me contacter » devient une opposition', async () => {
      const [id] = await integrer({ entreprise: 'A Fictif', nom: 'Un', email: 'un@a.test' });
      const r = await reponse(id ?? '', { classe: 'ne_plus_contacter' });
      await validerReponse(t.app.db, base.id, r);
      const f = await fiche(id ?? '');
      expect(f).toMatchObject({ opposition: true, resultat: 'pas_interesse' });
      expect(f?.alertes.map((a) => a.code)).toContain('opposition');
    });

    it('refuse de valider sans classe', async () => {
      const [id] = await integrer({ entreprise: 'A Fictif', nom: 'Un', email: 'un@a.test' });
      const r = await reponse(id ?? '');
      await expect(validerReponse(t.app.db, base.id, r)).rejects.toThrow(ClasseRefusee);
    });
  });

  describe('entrée dans le CRM du mandat', () => {
    it('crée l’entreprise, le contact et une activité email datée, et garde le lien', async () => {
      const [id] = await integrer({
        entreprise: 'Atelier Fictif',
        prenom: 'Léa',
        nom: 'Martin',
        email: 'lea@atelier-fictif.test',
        fonction: 'Directrice',
      });
      await aRepondu(id ?? '');
      expect(await entrerDansCrm(t.app.db, deps(), base.id, id ?? '')).toEqual({
        resultat: 'cree',
        mandat: 'Mandat Fictif',
      });
      const [c] = await t.owner.db.select().from(contacts);
      expect(c).toMatchObject({
        instanceId: mandat.id,
        nom: 'Léa MARTIN',
        email: 'lea@atelier-fictif.test',
        fonction: 'Directrice',
      });
      const [e] = await t.owner.db.select().from(entreprises);
      expect(e).toMatchObject({
        instanceId: mandat.id,
        nom: 'Atelier Fictif',
        domaine: 'atelier-fictif.test',
      });
      const [a] = await t.owner.db.select().from(activites);
      expect(a).toMatchObject({ instanceId: mandat.id, type: 'email', contactId: c?.id });
      expect(a?.at.toISOString()).toBe('2026-09-12T09:00:00.000Z');
      expect(a?.resume).toBeNull();
      expect(await fiche(id ?? '')).toMatchObject({ crmMandat: 'Mandat Fictif' });
      expect(await entrerDansCrm(t.app.db, deps(), base.id, id ?? '')).toEqual({
        resultat: 'refuse',
        raison: 'Déjà dans le CRM de Mandat Fictif.',
      });
      expect(await t.owner.db.select().from(contacts)).toHaveLength(1);
    });

    it('rattache la fiche au contact déjà présent dans le CRM, sans doublon', async () => {
      const [id] = await integrer({
        entreprise: 'Atelier Fictif',
        nom: 'Martin',
        email: 'lea@atelier-fictif.test',
      });
      await aRepondu(id ?? '');
      await t.owner.db
        .insert(contacts)
        .values({ instanceId: mandat.id, nom: 'Léa Martin', email: 'LEA@atelier-fictif.test' });
      expect((await entrerDansCrm(t.app.db, deps(), base.id, id ?? '')).resultat).toBe('existant');
      expect(await t.owner.db.select().from(contacts)).toHaveLength(1);
      expect(await t.owner.db.select().from(activites)).toHaveLength(1);
    });

    it('refuse une fiche à enrichir, une opposition, une exclusion ou un mandat inconnu', async () => {
      const [enrichir, opposee, exclue, inconnu] = await integrer(
        { entreprise: 'A Fictif', nom: 'Un' },
        { entreprise: 'B Fictif', nom: 'Deux', email: 'deux@b.test' },
        { entreprise: 'C Fictif', nom: 'Trois', email: 'trois@c.test' },
        { entreprise: 'D Fictif', nom: 'Quatre', email: 'quatre@d.test' },
      );
      for (const id of [enrichir, opposee, exclue]) await aRepondu(id ?? '');
      await aRepondu(inconnu ?? '', 'Mandat disparu');
      await withInstance(t.app.db, base.id, async (tx) => {
        await majConformite(tx, base.id, opposee ?? '', { opposition: true });
        await majConformite(tx, base.id, exclue ?? '', { exclusion: 'concurrent' });
      });
      const raison = async (id?: string) => {
        const r = await entrerDansCrm(t.app.db, deps(), base.id, id ?? '');
        return r.resultat === 'refuse' ? r.raison : r.resultat;
      };
      expect(await raison(enrichir)).toMatch(/à enrichir/);
      expect(await raison(opposee)).toMatch(/Opposition/);
      expect(await raison(exclue)).toMatch(/Exclu \(concurrent\)/);
      expect(await raison(inconnu)).toMatch(/mandat .* introuvable/);
      expect(await t.owner.db.select().from(contacts)).toHaveLength(0);
    });

    it('un mandat sous HubSpot suit le double verrou : simulation, rien n’est créé', async () => {
      const [id] = await integrer({
        entreprise: 'Atelier Fictif',
        nom: 'Martin',
        email: 'lea@atelier-fictif.test',
      });
      await aRepondu(id ?? '', 'Mandat HubSpot');
      expect(await entrerDansCrm(t.app.db, deps(), base.id, id ?? '')).toEqual({
        resultat: 'simulation',
        mandat: 'Mandat HubSpot',
      });
      expect(await t.owner.db.select().from(contacts)).toHaveLength(0);
      expect(await t.owner.db.select().from(activites)).toHaveLength(0);
      expect((await fiche(id ?? ''))?.crmMandat).toBeNull();
    });

    it('fait entrer tous les répondants, et seulement eux', async () => {
      const [repond, silence, opposee] = await integrer(
        { entreprise: 'A Fictif', nom: 'Un', email: 'un@a.test' },
        { entreprise: 'B Fictif', nom: 'Deux', email: 'deux@b.test' },
        { entreprise: 'C Fictif', nom: 'Trois', email: 'trois@c.test' },
      );
      await aRepondu(repond ?? '');
      await aRepondu(opposee ?? '');
      await withInstance(t.app.db, base.id, (tx) =>
        majConformite(tx, base.id, opposee ?? '', { opposition: true }),
      );
      expect(await entrerRepondants(t.app.db, deps(), base.id)).toEqual({
        cree: 1,
        existant: 0,
        simulation: 0,
        refuse: 1,
      });
      expect((await fiche(silence ?? ''))?.crmMandat).toBeNull();
    });
  });

  describe('outils de la routine', () => {
    const outil = (nom: string) => {
      const o = toolsFor('instance').find((x) => x.name === nom);
      if (!o) throw new Error(`outil absent : ${nom}`);
      return o;
    };
    const appeler = <T>(nom: string, input: object): Promise<T> =>
      withInstance(t.app.db, base.id, async (tx) => {
        const ctx: ToolCtx = {
          instance: base,
          tx,
          acteur: 'claude',
          deps: {
            db: t.app.db,
            pool: t.app.pool,
            lectureRole: t.lectureRole,
            realWrites: false,
            secretsDir: './x',
          },
        };
        const resultat = (await outil(nom).handler(ctx, input as never)) as T;
        // The instance context must still be the base's one after the tool ran.
        const r = await tx.execute<{ v: string }>(
          (await import('drizzle-orm')).sql`select current_setting('app.instance_id') as v`,
        );
        expect(r.rows[0]?.v).toBe(base.id);
        return resultat;
      });

    const importer = async () => {
      const [imp] = await creerImports(t.app.db, base.id, {
        nomFichier: 'x.csv',
        contenu: Buffer.from(
          'Société;Interlocuteur;Code;Mail\nAtelier Fictif;Léa Martin;A1;lea@atelier-fictif.test\nBureau Fictif;;A2;\n;Paul Petit;A3;paul@bureau.test',
        ),
        provenance: 'Test',
      });
      return imp;
    };

    it('montre les colonnes non reconnues avec quelques exemples, jamais le fichier entier', async () => {
      const imp = await importer();
      const r = await appeler<{
        imports: {
          importId: string;
          colonnesNonReconnues: { entete: string; exemples: string[] }[];
          entetes: string[];
        }[];
      }>('base_imports_a_traiter', {});
      expect(r.imports).toHaveLength(1);
      expect(r.imports[0]?.importId).toBe(imp?.id);
      expect(r.imports[0]?.colonnesNonReconnues.map((c) => [c.entete, c.exemples])).toEqual([
        ['Code', ['A1', 'A2', 'A3']],
      ]);
      expect(JSON.stringify(r)).not.toContain('Paul Petit');
    });

    it('propose une correspondance, relit toutes les lignes, sans rien écrire dans la base', async () => {
      const imp = await importer();
      const r = await appeler<{ compteurs: { prospectables: number } }>(
        'base_proposer_correspondance',
        {
          importId: imp?.id,
          correspondance: { entreprise: 0, nomComplet: 1, email: 3, fonction: 2 },
        },
      );
      expect(r.compteurs.prospectables).toBe(2);
      expect((await listerFiches(t.app.db, base.id)).total).toBe(0);
    });

    it('liste puis corrige les lignes sous le minimum', async () => {
      const imp = await importer();
      const l = await appeler<{ numero: number; raison: string }[]>('base_lignes_signalees', {
        importId: imp?.id,
        statut: 'sous_minimum',
        limite: 30,
      });
      // Line 3 has no company, but its address (paul@bureau.test) gives one.
      expect(l.map((x) => [x.numero, x.raison])).toEqual([[2, 'Nom manquant']]);
      const c = await appeler<{ statut: string; zone: string }>('base_corriger_ligne', {
        importId: imp?.id,
        numero: 2,
        nom: 'Roche',
      });
      expect(c).toMatchObject({ statut: 'pret', zone: 'a_enrichir' });
    });

    it('propose la classe d’une réponse sans valider', async () => {
      const [id] = await integrer({ entreprise: 'A Fictif', nom: 'Un', email: 'un@a.test' });
      const r = await reponse(id ?? '');
      const aClasser = await appeler<{ reponseId: string; extrait: string }[]>(
        'base_reponses_a_classer',
        {},
      );
      expect(aClasser.map((x) => [x.reponseId, x.extrait])).toEqual([
        [r, 'Merci, pas pour le moment.'],
      ]);
      expect(
        await appeler('base_classer_reponse', { reponseId: r, classe: 'ne_plus_contacter' }),
      ).toEqual({
        reponseId: r,
        classe: 'ne_plus_contacter',
        validee: false,
      });
      expect((await fiche(id ?? ''))?.opposition).toBe(false);
    });

    it('n’offre aucun outil qui écrit dans la base vivante ou dans un CRM', () => {
      const noms = toolsFor('instance')
        .map((o) => o.name)
        .filter((n) => n.startsWith('base_'));
      expect(noms.sort()).toEqual([
        'base_classer_reponse',
        'base_corriger_ligne',
        'base_imports_a_traiter',
        'base_lignes_signalees',
        'base_proposer_correspondance',
        'base_reponses_a_classer',
      ]);
    });
  });
});
