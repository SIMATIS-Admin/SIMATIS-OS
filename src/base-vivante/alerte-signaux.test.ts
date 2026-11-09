import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import type { EntrepriseAnnuaire } from '../annuaire/client.js';
import { withInstance } from '../db/context.js';
import { sujets } from '../inbox/schema.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { ErreurBodacc, type AnnonceBrute, type ClientBodacc } from '../signaux/bodacc.js';
import {
  enregistrerRoutineAlerte,
  lancerAlerte,
  lireRoutineAlerte,
  tournerAlertes,
} from './alerte-signaux.js';
import { enregistrerEntreprise } from './entreprises.js';
import { registerBaseVivanteRoutes } from './routes.js';
import { baseEntreprises } from './schema.js';

const MAINTENANT = new Date('2026-11-09T10:00:00Z');

const entreprise = (siren: string, nom: string): EntrepriseAnnuaire => ({
  siren,
  nom,
  formeJuridique: null,
  naf: null,
  categorie: null,
  effectif: null,
  creeLe: null,
  active: true,
  etablissementsOuverts: null,
  oppositionDiffusion: false,
  siret: null,
  adresse: null,
  codePostal: null,
  ville: null,
  departement: null,
  latitude: null,
  longitude: null,
  finances: [],
  dirigeants: [],
});

const procedure = (id: string, date: string): AnnonceBrute => ({
  id,
  dateparution: date,
  typeavis_lib: 'Avis initial',
  familleavis_lib: 'Procédures collectives',
  tribunal: null,
  url_complete: `https://www.bodacc.fr/pages/annonces-commerciales-detail/?q.id=id:${id}`,
  jugement: JSON.stringify({
    nature: 'Jugement d’ouverture de liquidation judiciaire',
    complementJugement: 'Liquidation judiciaire.',
  }),
  acte: null,
  modificationsgenerales: null,
  radiationaurcs: null,
});
const cession = (id: string, date: string): AnnonceBrute => ({
  ...procedure(id, date),
  familleavis_lib: 'Ventes et cessions',
  jugement: null,
  acte: JSON.stringify({ vente: { categorieVente: 'Cession de fonds' } }),
});
const modification = (id: string, date: string): AnnonceBrute => ({
  ...procedure(id, date),
  familleavis_lib: 'Modifications diverses',
  jugement: null,
  modificationsgenerales: '{"descriptif":"Changement de gérant."}',
});

describe('base vivante : alerte quotidienne du BODACC', () => {
  let t: TestApp;
  let base: Instance;
  let ids: Record<string, string>;
  const annonces = vi.fn<ClientBodacc['annonces']>();
  const bodacc: ClientBodacc = { annonces };

  beforeAll(async () => {
    t = await setupTestApp();
    base = await createInstance(t.owner.db, { slug: 'bv-al', nom: 'Base', type: 'propre' });
  });
  afterAll(async () => {
    await t.drop();
  });
  beforeEach(async () => {
    for (const table of ['sujets', 'base_signaux', 'base_entreprises', 'preferences'])
      await t.owner.pool.query(`delete from ${table}`);
    ids = await withInstance(t.app.db, base.id, async (tx) => ({
      a: (await enregistrerEntreprise(tx, base.id, entreprise('111111111', 'ATELIER'))).id,
      b: (await enregistrerEntreprise(tx, base.id, entreprise('222222222', 'BUREAU'))).id,
    }));
    annonces.mockReset().mockResolvedValue([]);
  });

  const lesSujets = () => t.owner.db.select().from(sujets);
  const verifiees = (...cles: string[]) =>
    withInstance(t.app.db, base.id, async (tx) => {
      for (const c of cles)
        await tx
          .update(baseEntreprises)
          .set({ signauxLe: new Date('2026-11-01T08:00:00Z') })
          .where(eq(baseEntreprises.id, ids[c] ?? ''));
    });

  it('à la première lecture, ne signale que les annonces des deux dernières semaines', async () => {
    annonces.mockImplementation((siren) =>
      Promise.resolve(
        siren === '111111111'
          ? [
              procedure('A1', '2026-11-05'),
              procedure('A0', '2026-03-01'),
              cession('A2', '2026-11-06'),
            ]
          : [],
      ),
    );
    const r = await lancerAlerte(t.app.db, bodacc, base.id, { maintenant: MAINTENANT });
    expect(r).toEqual({ verifiees: 2, nouveaux: 3, deposes: 2, echecs: 0 });
    const s = await lesSujets();
    expect(s.map((x) => x.sourceId).sort()).toEqual([`${ids.a}:A1`, `${ids.a}:A2`]);
  });

  it('dépose dans l’Inbox un sujet clair, plus prioritaire pour une alerte que pour une cession', async () => {
    annonces.mockImplementation((siren) =>
      Promise.resolve(
        siren === '111111111' ? [procedure('A1', '2026-11-05'), cession('A2', '2026-11-06')] : [],
      ),
    );
    await lancerAlerte(t.app.db, bodacc, base.id, { maintenant: MAINTENANT });
    const s = await lesSujets();
    const alerte = s.find((x) => (x.sourceId ?? '').endsWith(':A1'));
    const attention = s.find((x) => (x.sourceId ?? '').endsWith(':A2'));
    expect(alerte).toMatchObject({
      type: 'autre',
      origine: 'os',
      source: 'bodacc',
      statut: 'a_traiter',
      priorite: 4,
      titre: 'BODACC : ATELIER, Jugement d’ouverture de liquidation judiciaire',
      lien: 'https://www.bodacc.fr/pages/annonces-commerciales-detail/?q.id=id:A1',
    });
    expect(alerte?.resume).toContain('Procédure collective');
    expect(alerte?.resume).toContain('05/11/2026');
    expect(attention?.priorite).toBe(3);
  });

  it('signale une annonce nouvelle même ancienne quand l’entreprise était déjà suivie, une seule fois', async () => {
    await verifiees('a', 'b');
    annonces.mockImplementation((siren) =>
      Promise.resolve(siren === '111111111' ? [procedure('A9', '2026-09-20')] : []),
    );
    const un = await lancerAlerte(t.app.db, bodacc, base.id, { maintenant: MAINTENANT });
    expect(un).toMatchObject({ nouveaux: 1, deposes: 1 });
    const deux = await lancerAlerte(t.app.db, bodacc, base.id, { maintenant: MAINTENANT });
    expect(deux).toMatchObject({ nouveaux: 0, deposes: 0 });
    expect(await lesSujets()).toHaveLength(1);
  });

  it('un sujet traité ne revient jamais', async () => {
    await verifiees('a', 'b');
    const seulementA = (siren: string) =>
      Promise.resolve(siren === '111111111' ? [procedure('A9', '2026-11-05')] : []);
    annonces.mockImplementation(seulementA);
    await lancerAlerte(t.app.db, bodacc, base.id, { maintenant: MAINTENANT });
    await t.owner.pool.query("update sujets set statut = 'traite'");
    await t.owner.pool.query('delete from base_signaux');
    await lancerAlerte(t.app.db, bodacc, base.id, { maintenant: MAINTENANT });
    const s = await lesSujets();
    expect(s).toHaveLength(1);
    expect(s[0]?.statut).toBe('traite');
  });

  it('ne dépose rien pour une simple information', async () => {
    await verifiees('a', 'b');
    annonces.mockResolvedValue([modification('M1', '2026-11-07')]);
    const r = await lancerAlerte(t.app.db, bodacc, base.id, { maintenant: MAINTENANT });
    expect(r).toMatchObject({ nouveaux: 2, deposes: 0 });
    expect(await lesSujets()).toHaveLength(0);
  });

  it('commence par les entreprises jamais vérifiées, dans la limite fixée, et compte les échecs', async () => {
    await verifiees('a');
    const r = await lancerAlerte(t.app.db, bodacc, base.id, { maintenant: MAINTENANT, limite: 1 });
    expect(r.verifiees).toBe(1);
    expect(annonces.mock.calls.map((c) => c[0])).toEqual(['222222222']);
    annonces.mockRejectedValue(new ErreurBodacc('BODACC indisponible.'));
    const hs = await lancerAlerte(t.app.db, bodacc, base.id, { maintenant: MAINTENANT });
    expect(hs).toEqual({ verifiees: 0, nouveaux: 0, deposes: 0, echecs: 2 });
  });

  describe('planification', () => {
    const regler = (reglages: { active: boolean; heure: string }) =>
      enregistrerRoutineAlerte(t.app.db, base.id, reglages);

    it('est éteinte par défaut et se règle', async () => {
      expect(await lireRoutineAlerte(t.app.db, base.id)).toEqual({ active: false, heure: '08:00' });
      await regler({ active: true, heure: '07:30' });
      expect(await lireRoutineAlerte(t.app.db, base.id)).toMatchObject({
        active: true,
        heure: '07:30',
      });
    });

    it('ne tourne ni éteinte ni avant l’heure, puis une seule fois par jour', async () => {
      annonces.mockResolvedValue([procedure('A1', '2026-11-08')]);
      await tournerAlertes(t.app.db, bodacc, MAINTENANT);
      expect(annonces).not.toHaveBeenCalled();
      await regler({ active: true, heure: '12:00' });
      await tournerAlertes(t.app.db, bodacc, MAINTENANT); // 11:00 à Paris
      expect(annonces).not.toHaveBeenCalled();
      await regler({ active: true, heure: '10:30' });
      await tournerAlertes(t.app.db, bodacc, MAINTENANT);
      expect(annonces).toHaveBeenCalledTimes(2);
      const routine = await lireRoutineAlerte(t.app.db, base.id);
      expect(routine.dernierJour).toBe('2026-11-09');
      expect(routine.bilan).toContain('2 entreprises vérifiées');
      await tournerAlertes(t.app.db, bodacc, new Date('2026-11-09T15:00:00Z'));
      expect(annonces).toHaveBeenCalledTimes(2);
      await tournerAlertes(t.app.db, bodacc, new Date('2026-11-10T10:00:00Z'));
      expect(annonces).toHaveBeenCalledTimes(4);
    });

    it('garde le réglage quand le BODACC est en panne et le dit dans le bilan', async () => {
      annonces.mockRejectedValue(new ErreurBodacc('BODACC indisponible.'));
      await regler({ active: true, heure: '08:00' });
      await tournerAlertes(t.app.db, bodacc, MAINTENANT);
      const routine = await lireRoutineAlerte(t.app.db, base.id);
      expect(routine.active).toBe(true);
      expect(routine.bilan).toContain('2 non lues');
    });
  });

  describe('API', () => {
    const app = () => {
      const a = Fastify();
      registerBaseVivanteRoutes(a, { db: t.app.db, bodacc });
      return a;
    };
    const appel = async (method: 'GET' | 'PUT' | 'POST', url: string, payload?: unknown) => {
      const r = await app().inject({
        method,
        url: `/api/i/bv-al/base/signaux/routine${url}`,
        payload: payload as object,
      });
      return { status: r.statusCode, corps: r.json<Record<string, unknown>>() };
    };

    it('lit, règle et refuse un réglage invalide', async () => {
      expect((await appel('GET', '')).corps).toEqual({ active: false, heure: '08:00' });
      expect((await appel('PUT', '', { active: true, heure: '06:45' })).corps).toMatchObject({
        active: true,
        heure: '06:45',
      });
      expect((await appel('PUT', '', { active: true, heure: '25:00' })).status).toBe(400);
      expect((await appel('PUT', '', { active: 'oui', heure: '08:00' })).status).toBe(400);
    });

    it('vérifie tout de suite à la demande et rend le rapport', async () => {
      annonces.mockResolvedValue([procedure('A1', '2026-11-08')]);
      const r = await appel('POST', '/lancer', {});
      expect(r.status).toBe(200);
      expect(r.corps).toMatchObject({ verifiees: 2, nouveaux: 2 });
    });
  });
});
