import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import type { EntrepriseAnnuaire } from '../annuaire/client.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { ErreurSite, type LecteurWeb } from '../site-entreprise/reseau.js';
import { enregistrerEntreprise } from './entreprises.js';
import { integrerFiches, rattacherEntreprise } from './integration.js';
import { normaliserFiche, type Brut } from './nettoyage.js';
import { registerBaseVivanteRoutes } from './routes.js';

type Json = Record<string, unknown>;

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

const accueil = (extra = '') =>
  `<html><body><a href="/mentions">Mentions légales</a>${extra}<p>Standard 04 37 25 05 73 — contact@exemple.test</p></body></html>`;

describe('base vivante : site web de l’entreprise', () => {
  let t: TestApp;
  let base: Instance;
  let autre: Instance;
  let id: string;
  const lire = vi.fn<LecteurWeb['lire']>();

  beforeAll(async () => {
    t = await setupTestApp();
    base = await createInstance(t.owner.db, { slug: 'bv-st', nom: 'Base', type: 'propre' });
    autre = await createInstance(t.owner.db, { slug: 'bv-st-b', nom: 'Autre', type: 'propre' });
  });
  afterAll(async () => {
    await t.drop();
  });
  beforeEach(async () => {
    for (const table of ['base_vivante', 'base_entreprises'])
      await t.owner.pool.query(`delete from ${table}`);
    lire.mockReset().mockImplementation((url) =>
      Promise.resolve({
        url,
        html: url.endsWith('/mentions')
          ? '<p>EXEMPLE SAS, SIREN 123 456 789. info@exemple.test</p>'
          : accueil('<a href="https://www.linkedin.com/company/exemple">in</a>'),
      }),
    );
    id = await withInstance(
      t.app.db,
      base.id,
      async (tx) =>
        (await enregistrerEntreprise(tx, base.id, entreprise('123456789', 'EXEMPLE'))).id,
    );
  });

  const fiches = async (instance: Instance, ...brutes: Brut[]) => {
    const res = await withInstance(t.app.db, instance.id, (tx) =>
      integrerFiches(
        tx,
        instance.id,
        brutes.map((b) => ({
          fiche: normaliserFiche(b).fiche,
          provenance: 'Sharp',
          mandat: null,
          importId: null,
          collecteLe: null,
        })),
      ),
    );
    return res.map((r) => r.id);
  };
  const rattacher = (instance: Instance, ficheIds: string[], entrepriseId: string) =>
    withInstance(t.app.db, instance.id, async (tx) => {
      for (const f of ficheIds) await rattacherEntreprise(tx, instance.id, f, entrepriseId);
    });
  const app = () => {
    const a = Fastify();
    registerBaseVivanteRoutes(a, { db: t.app.db, lecteurWeb: { lire } });
    return a;
  };
  const lireSiteVia = async (entrepriseId: string, payload: unknown = {}, slug = 'bv-st') => {
    const r = await app().inject({
      method: 'POST',
      url: `/api/i/${slug}/base/entreprises/${entrepriseId}/site`,
      payload: payload as Json,
    });
    return { status: r.statusCode, corps: r.json<Json>() };
  };
  const ligne = async () =>
    (await t.owner.pool.query('select * from base_entreprises where id = $1', [id]))
      .rows[0] as Json;

  it('lit le site donné, enregistre ce qu’il révèle et confirme qu’il est bien celui de l’entreprise', async () => {
    const r = await lireSiteVia(id, { url: 'https://exemple.test/' });
    expect(r.status).toBe(200);
    expect(r.corps).toMatchObject({
      siteWeb: 'https://exemple.test/',
      siteTelephones: ['+33437250573'],
      siteEmails: ['contact@exemple.test', 'info@exemple.test'],
      linkedin: 'https://www.linkedin.com/company/exemple',
      siteConfirme: true,
    });
    expect(r.corps.siteLuLe).toEqual(expect.any(String));
    expect((await ligne()).site_web).toBe('https://exemple.test/');
  });

  it('ajoute https:// à une adresse saisie sans schéma', async () => {
    await lireSiteVia(id, { url: '  exemple.test  ' });
    expect(lire.mock.calls[0]?.[0]).toBe('https://exemple.test');
  });

  it('retrouve le site par le domaine des contacts quand on ne le connaît pas', async () => {
    const f = await fiches(
      base,
      { entreprise: 'Exemple', nom: 'Un', email: 'un@exemple.test' },
      { entreprise: 'Exemple', nom: 'Deux', email: 'deux@exemple.test' },
      { entreprise: 'Exemple', nom: 'Trois', email: 'trois@autre-domaine.test' },
    );
    await rattacher(base, f, id);
    const r = await lireSiteVia(id);
    expect(r.status).toBe(200);
    expect(lire.mock.calls[0]?.[0]).toBe('https://exemple.test');
  });

  it('relit le site déjà enregistré quand on ne donne rien', async () => {
    await lireSiteVia(id, { url: 'https://exemple.test/' });
    lire.mockClear();
    await lireSiteVia(id);
    expect(lire.mock.calls[0]?.[0]).toBe('https://exemple.test/');
  });

  it('demande l’adresse quand aucun site n’est connu, y compris avec des adresses personnelles', async () => {
    const f = await fiches(base, { entreprise: 'Exemple', nom: 'Un', email: 'un@gmail.com' });
    await rattacher(base, f, id);
    const r = await lireSiteVia(id);
    expect(r.status).toBe(400);
    expect(r.corps.error).toMatch(/aucun site/i);
    expect(lire).not.toHaveBeenCalled();
  });

  it('complète l’e-mail général des contacts de l’entreprise, sans jamais écraser', async () => {
    const f = await fiches(
      base,
      { entreprise: 'Exemple', nom: 'Un', email: 'un@exemple.test' },
      { entreprise: 'Exemple', nom: 'Deux', email: 'deux@exemple.test' },
    );
    await rattacher(base, f, id);
    await t.owner.pool.query(
      "update base_vivante set email_entreprise = 'accueil@exemple.test' where id = $1",
      [f[1]],
    );
    await lireSiteVia(id, { url: 'https://exemple.test/' });
    const { rows } = await t.owner.pool.query<{ nom: string; email_entreprise: string | null }>(
      'select nom, email_entreprise from base_vivante order by nom',
    );
    expect(rows).toEqual([
      { nom: 'DEUX', email_entreprise: 'accueil@exemple.test' },
      { nom: 'UN', email_entreprise: 'contact@exemple.test' },
    ]);
  });

  it('ne confirme pas un site qui ne cite pas le SIREN', async () => {
    lire.mockResolvedValue({ url: 'https://autre.test/', html: '<p>Bonjour 04 37 25 05 73</p>' });
    const r = await lireSiteVia(id, { url: 'https://autre.test/' });
    expect(r.corps).toMatchObject({ siteConfirme: false, siteEmails: [] });
  });

  it('refuse un site illisible ou interdit, sans rien enregistrer', async () => {
    lire.mockRejectedValue(
      new ErreurSite('Adresse refusée : elle mène au réseau privé de cette machine.'),
    );
    const r = await lireSiteVia(id, { url: 'http://127.0.0.1/' });
    expect(r.status).toBe(400);
    expect(r.corps.error).toContain('réseau privé');
    expect((await ligne()).site_web).toBeNull();
    expect((await lireSiteVia(id, { url: 'x'.repeat(400) })).status).toBe(400);
  });

  it('cloisonne par instance et refuse une entreprise inconnue', async () => {
    expect((await lireSiteVia('00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await lireSiteVia(id, { url: 'https://exemple.test/' }, 'bv-st-b')).status).toBe(404);
    const autreId = await withInstance(
      t.app.db,
      autre.id,
      async (tx) =>
        (await enregistrerEntreprise(tx, autre.id, entreprise('123456789', 'AUTRE'))).id,
    );
    expect((await lireSiteVia(autreId, { url: 'https://exemple.test/' }, 'bv-st-b')).status).toBe(
      200,
    );
  });
});
