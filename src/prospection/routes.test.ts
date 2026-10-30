import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insererFiche } from '../../test/fiche-base.js';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { buildApp } from '../app.js';
import { contacts, entreprises, taches } from '../crm/schema.js';
import { configureConnexion, registerConnector } from '../connexions/service.js';
import { withInstance } from '../db/context.js';
import { sujets } from '../inbox/schema.js';
import { prospectionOccurrences } from './schema.js';
import { createInstance } from '../instances/service.js';
import { demarrerCampagne, deposerBrouillons } from './redaction.js';
import type { CampagneVue } from './campagnes.js';
import type { StatsProspection } from './stats.js';
import type { SignatureVue } from './signatures.js';

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(16),
]);
// Boîte mail fictive : en simulation, rien n'est créé (écritures réelles fermées).
registerConnector({
  fournisseur: 'boite-test',
  sync: () => Promise.resolve({ lus: 0, crees: 0, maj: 0, erreurs: [] }),
  write: () => Promise.resolve({ simulation: true }),
});
const image = { typeMime: 'image/png', imageBase64: png.toString('base64') };

describe('Routes de la prospection', () => {
  let t: TestApp;
  let app: ReturnType<typeof buildApp>;
  let secretsDir: string;
  const base = '/api/i/prosp-routes/prospection';
  const autre = '/api/i/prosp-autre/prospection';
  let instanceId: string;

  beforeAll(async () => {
    t = await setupTestApp();
    instanceId = (
      await createInstance(t.owner.db, { slug: 'prosp-routes', nom: 'Routes', type: 'mandat' })
    ).id;
    await createInstance(t.owner.db, { slug: 'prosp-autre', nom: 'Autre', type: 'mandat' });
    await withInstance(t.app.db, instanceId, (tx) =>
      configureConnexion(tx, { kind: 'messagerie', fournisseur: 'boite-test' }),
    );
    secretsDir = await mkdtemp(path.join(tmpdir(), 'simatis-prosp-routes-'));
    app = buildApp({ pool: t.app.pool, db: t.app.db, version: 'test', secretsDir });
  });

  afterAll(async () => {
    await app.close();
    await t.drop();
    await rm(secretsDir, { recursive: true, force: true });
  });

  const vue = async (url = base) =>
    (await app.inject({ method: 'GET', url })).json<{
      stats: StatsProspection;
      signatures: SignatureVue[];
    }>();

  it("renvoie des zéros et l'objectif 30 pour une instance neuve", async () => {
    const v = await vue();
    expect(v.stats).toMatchObject({ jour: 0, semaine: 0, objectif: 30 });
    expect(v.signatures).toEqual([]);
    // Les écritures réelles sont fermées dans ce test : l'envoi direct n'est pas proposé.
    expect(
      (await app.inject({ method: 'GET', url: base })).json<{ envoiPossible: boolean }>()
        .envoiPossible,
    ).toBe(false);
  });

  it('404 sur une instance inconnue', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/i/inconnue/prospection' });
    expect(r.statusCode).toBe(404);
  });

  it("règle l'objectif puis le relit ; 400 au-delà de 500", async () => {
    const ok = await app.inject({
      method: 'PUT',
      url: `${base}/objectif`,
      payload: { objectif: 45 },
    });
    expect(ok.statusCode).toBe(200);
    expect((await vue()).stats.objectif).toBe(45);
    const trop = await app.inject({
      method: 'PUT',
      url: `${base}/objectif`,
      payload: { objectif: 501 },
    });
    expect(trop.statusCode).toBe(400);
    const texte = await app.inject({
      method: 'PUT',
      url: `${base}/objectif`,
      payload: { objectif: 'beaucoup' },
    });
    expect(texte.statusCode).toBe(400);
  });

  it("cycle complet d'une signature : création, défaut, image servie, renommage, suppression", async () => {
    const cree = await app.inject({
      method: 'POST',
      url: `${base}/signatures`,
      payload: { nom: 'Simatis', ...image },
    });
    expect(cree.statusCode).toBe(201);
    const { id } = cree.json<SignatureVue>();

    const defaut = await app.inject({
      method: 'PATCH',
      url: `${base}/signatures/${id}`,
      payload: { defaut: true },
    });
    expect(defaut.statusCode).toBe(200);
    expect((await vue()).signatures).toEqual([
      { id, nom: 'Simatis', defaut: true, typeMime: 'image/png' },
    ]);

    const img = await app.inject({ method: 'GET', url: `${base}/signatures/${id}/image` });
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.headers['cache-control']).toContain('private');
    expect(img.rawPayload.equals(png)).toBe(true);

    const renomme = await app.inject({
      method: 'PATCH',
      url: `${base}/signatures/${id}`,
      payload: { nom: 'Simatis et Kairos' },
    });
    expect(renomme.statusCode).toBe(200);
    const remplace = await app.inject({
      method: 'PUT',
      url: `${base}/signatures/${id}/image`,
      payload: image,
    });
    expect(remplace.statusCode).toBe(200);
    expect((await vue()).signatures[0]?.nom).toBe('Simatis et Kairos');

    const suppr = await app.inject({ method: 'DELETE', url: `${base}/signatures/${id}` });
    expect(suppr.statusCode).toBe(200);
    expect((await vue()).signatures).toEqual([]);
  });

  it('400 sur une image invalide, avec un message clair', async () => {
    const r = await app.inject({
      method: 'POST',
      url: `${base}/signatures`,
      payload: {
        nom: 'Cassée',
        typeMime: 'image/png',
        imageBase64: Buffer.from('texte').toString('base64'),
      },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json<{ error: string }>().error).toContain('PNG');
  });

  it("404 sur une signature d'une autre instance", async () => {
    const cree = await app.inject({
      method: 'POST',
      url: `${autre}/signatures`,
      payload: { nom: 'Autre', ...image },
    });
    const { id } = cree.json<SignatureVue>();
    expect(
      (await app.inject({ method: 'GET', url: `${base}/signatures/${id}/image` })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'DELETE', url: `${base}/signatures/${id}` })).statusCode,
    ).toBe(404);
    expect((await vue()).signatures).toEqual([]);
  });

  describe('campagne de relance', () => {
    const reglage = {
      offre: 'vma',
      creneaux: true,
      signatureId: null,
      suivi: { type: 'courte' },
      touchesMax: 4,
    };

    async function tache(nom: string) {
      const [e] = await t.owner.db
        .insert(entreprises)
        .values({ instanceId, nom: `Société ${nom}` })
        .returning({ id: entreprises.id });
      const [c] = await t.owner.db
        .insert(contacts)
        .values({
          instanceId,
          nom,
          entrepriseId: e!.id,
          email: `${nom.toLowerCase()}@exemple.test`,
        })
        .returning({ id: contacts.id });
      const [tc] = await t.owner.db
        .insert(taches)
        .values({
          instanceId,
          titre: `Relancer ${nom}`,
          canal: 'email',
          contactId: c!.id,
          echeance: new Date(),
        })
        .returning({ id: taches.id });
      return tc!.id;
    }
    const campagne = async (id: string) =>
      (await app.inject({ method: 'GET', url: `${base}/campagnes/${id}` })).json<CampagneVue>();

    it('liste les tâches de relance utilisables', async () => {
      const id = await tache('Alice');
      const liste = (await app.inject({ method: 'GET', url: `${base}/taches-relance` })).json<
        { id: string; contactNom: string; touche: number; utilisable: boolean }[]
      >();
      expect(liste.find((x) => x.id === id)).toMatchObject({
        contactNom: 'Alice',
        touche: 2,
        utilisable: true,
      });
    });

    it('parcours : création, rédaction, relecture, finalisation en simulation', async () => {
      const id = await tache('Bruno');
      const cree = await app.inject({
        method: 'POST',
        url: `${base}/campagnes`,
        payload: { mode: 'relance', tacheIds: [id], reglage },
      });
      expect(cree.statusCode).toBe(201);
      const { campagneId } = cree.json<{ campagneId: string }>();
      expect((await campagne(campagneId)).statut).toBe('redaction');

      const [b] = (await campagne(campagneId)).brouillons;
      await withInstance(t.app.db, instanceId, async (tx) => {
        await demarrerCampagne(tx, campagneId);
        await deposerBrouillons(tx, campagneId, [
          { id: b!.id, objet: 'Re: Échange', corps: '<p>Bonjour Bruno,</p><p>Bien à vous,</p>' },
        ]);
      });
      expect((await campagne(campagneId)).statut).toBe('relecture');

      const modif = await app.inject({
        method: 'PATCH',
        url: `${base}/campagnes/${campagneId}/brouillons/${b!.id}`,
        payload: { suiviType: 'clos' },
      });
      expect(modif.statusCode).toBe(200);
      expect(modif.json<{ suiviType: string }>().suiviType).toBe('clos');

      const fin = await app.inject({
        method: 'POST',
        url: `${base}/campagnes/${campagneId}/finaliser`,
      });
      expect(fin.statusCode).toBe(200);
      expect(fin.json<{ simulation: boolean }>().simulation).toBe(true);
      expect((await campagne(campagneId)).statut).toBe('relecture');

      const vueProspection = (await app.inject({ method: 'GET', url: base })).json<{
        enCours: string | null;
      }>();
      expect(vueProspection.enCours).toBe(campagneId);
    });

    it('garde le style demandé dans le réglage de la campagne ; 400 s’il est trop long', async () => {
      const id = await tache('Camille');
      const cree = await app.inject({
        method: 'POST',
        url: `${base}/campagnes`,
        payload: { mode: 'relance', tacheIds: [id], reglage: { ...reglage, style: 'Très court' } },
      });
      expect(cree.statusCode).toBe(201);
      const { campagneId } = cree.json<{ campagneId: string }>();
      expect((await campagne(campagneId)).reglage.style).toBe('Très court');
      const trop = await app.inject({
        method: 'POST',
        url: `${base}/campagnes`,
        payload: {
          mode: 'relance',
          tacheIds: [id],
          reglage: { ...reglage, style: 'x'.repeat(2001) },
        },
      });
      expect(trop.statusCode).toBe(400);
    });

    it('refuse l’envoi direct tant que les verrous sont fermés', async () => {
      const id = await tache('Fabrice');
      const { campagneId } = (
        await app.inject({
          method: 'POST',
          url: `${base}/campagnes`,
          payload: { mode: 'relance', tacheIds: [id], reglage },
        })
      ).json<{ campagneId: string }>();
      const [b] = (await campagne(campagneId)).brouillons;
      await withInstance(t.app.db, instanceId, async (tx) => {
        await demarrerCampagne(tx, campagneId);
        await deposerBrouillons(tx, campagneId, [{ id: b!.id, objet: 'Re: x', corps: '<p>x</p>' }]);
      });
      const r = await app.inject({
        method: 'POST',
        url: `${base}/campagnes/${campagneId}/finaliser`,
        payload: { mode: 'envoi' },
      });
      expect(r.statusCode).toBe(400);
      expect(r.json<{ error: string }>().error).toContain('verrous');
      const mauvais = await app.inject({
        method: 'POST',
        url: `${base}/campagnes/${campagneId}/finaliser`,
        payload: { mode: 'autre' },
      });
      expect(mauvais.statusCode).toBe(400);
    });

    it('400 quand aucune tâche n’est utilisable, avec la raison', async () => {
      const r = await app.inject({
        method: 'POST',
        url: `${base}/campagnes`,
        payload: { mode: 'relance', tacheIds: ['00000000-0000-4000-8000-000000000001'], reglage },
      });
      expect(r.statusCode).toBe(400);
      expect(r.json<{ error: string }>().error).toContain('Aucune tâche utilisable');
    });

    it('400 sur un réglage invalide, 404 sur une campagne ou un brouillon inconnus', async () => {
      const id = await tache('Carole');
      const mauvais = await app.inject({
        method: 'POST',
        url: `${base}/campagnes`,
        payload: { mode: 'relance', tacheIds: [id], reglage: { ...reglage, offre: 'x' } },
      });
      expect(mauvais.statusCode).toBe(400);
      const inconnue = '00000000-0000-4000-8000-0000000000aa';
      expect(
        (await app.inject({ method: 'GET', url: `${base}/campagnes/${inconnue}` })).statusCode,
      ).toBe(404);
      expect(
        (
          await app.inject({
            method: 'PATCH',
            url: `${base}/campagnes/${inconnue}/brouillons/${inconnue}`,
            payload: { etat: 'pret' },
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (await app.inject({ method: 'POST', url: `${base}/campagnes/${inconnue}/finaliser` }))
          .statusCode,
      ).toBe(404);
    });

    it('relancer une campagne en erreur la remet en rédaction ; une autre est refusée', async () => {
      const id = await tache('Denis');
      const { campagneId } = (
        await app.inject({
          method: 'POST',
          url: `${base}/campagnes`,
          payload: { mode: 'relance', tacheIds: [id], reglage },
        })
      ).json<{ campagneId: string }>();
      expect(
        (await app.inject({ method: 'POST', url: `${base}/campagnes/${campagneId}/relancer` }))
          .statusCode,
      ).toBe(400);
    });

    it('rapprocher sans messagerie branchée ne plante pas', async () => {
      const r = await app.inject({ method: 'POST', url: `${base}/rapprocher` });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual({ envoyes: 0 });
    });

    it('une tâche sans contact devient utilisable avec le contact choisi', async () => {
      const [tc] = await t.owner.db
        .insert(taches)
        .values({
          instanceId,
          titre: 'Relance Mathis Roussel',
          canal: 'email',
          echeance: new Date(),
        })
        .returning({ id: taches.id });
      const [c] = await t.owner.db
        .insert(contacts)
        .values({ instanceId, nom: 'Mathis Roussel', email: 'mathis@exemple.test' })
        .returning({ id: contacts.id });
      const liste = (await app.inject({ method: 'GET', url: `${base}/taches-relance` })).json<
        { id: string; utilisable: boolean; suggestion: { contactId: string } | null }[]
      >();
      const vue = liste.find((x) => x.id === tc!.id)!;
      expect(vue.utilisable).toBe(false);
      expect(vue.suggestion?.contactId).toBe(c!.id);
      const sans = await app.inject({
        method: 'POST',
        url: `${base}/campagnes`,
        payload: { mode: 'relance', tacheIds: [tc!.id], reglage },
      });
      expect(sans.statusCode).toBe(400);
      const avec = await app.inject({
        method: 'POST',
        url: `${base}/campagnes`,
        payload: { mode: 'relance', tacheIds: [tc!.id], reglage, liens: { [tc!.id]: c!.id } },
      });
      expect(avec.statusCode).toBe(201);
    });

    it('cloisonne les campagnes entre instances', async () => {
      const id = await tache('Emma');
      const { campagneId } = (
        await app.inject({
          method: 'POST',
          url: `${base}/campagnes`,
          payload: { mode: 'relance', tacheIds: [id], reglage },
        })
      ).json<{ campagneId: string }>();
      expect(
        (await app.inject({ method: 'GET', url: `${autre}/campagnes/${campagneId}` })).statusCode,
      ).toBe(404);
    });
  });

  describe('prospection à froid', () => {
    async function fiche(nom: string) {
      const id = await insererFiche(t.owner.db, {
        instanceId,
        zone: 'prospectable',
        entreprise: `Atelier ${nom}`,
        prenom: nom,
        nom: 'Fictif',
        email: `${nom.toLowerCase()}@fictif.test`,
        provenance: 'Salon fictif',
      });
      return id;
    }
    const reglage = {
      offre: 'vma',
      creneaux: true,
      signatureId: null,
      suivi: { type: 'courte' },
      touchesMax: 4,
    };

    it('tire un échantillon, filtré, et le compte dans l’accueil', async () => {
      const id = await fiche('Zéphirine');
      const r = (
        await app.inject({ method: 'GET', url: `${base}/echantillon?nombre=5&filtre=zephirine` })
      ).json<{ id: string; touche: number }[]>();
      expect(r).toEqual([expect.objectContaining({ id, touche: 1 })]);
      const accueil = (await app.inject({ method: 'GET', url: base })).json<{
        froid: { disponibles: number };
      }>();
      expect(accueil.froid.disponibles).toBeGreaterThanOrEqual(1);
    });

    it('crée une campagne à froid, refuse un contact inconnu', async () => {
      const id = await fiche('Octave');
      const ok = await app.inject({
        method: 'POST',
        url: `${base}/campagnes`,
        payload: { mode: 'froid', baseIds: [id], reglage },
      });
      expect(ok.statusCode).toBe(201);
      const c = (
        await app.inject({
          method: 'GET',
          url: `${base}/campagnes/${ok.json<{ campagneId: string }>().campagneId}`,
        })
      ).json<CampagneVue>();
      expect(c.mode).toBe('froid');
      const ko = await app.inject({
        method: 'POST',
        url: `${base}/campagnes`,
        payload: { mode: 'froid', baseIds: ['00000000-0000-4000-8000-000000000001'], reglage },
      });
      expect(ko.statusCode).toBe(400);
    });

    it('liste, confirme et garde les contacts épuisés', async () => {
      const id = await fiche('Ursule');
      await t.owner.db.insert((await import('./schema.js')).prospectionSuiviFroid).values({
        instanceId,
        baseId: id,
        touches: 4,
        touchesMax: 4,
        derniereLe: new Date(Date.now() - 30 * 86400_000),
      });
      const liste = (await app.inject({ method: 'GET', url: `${base}/epuises` })).json<
        { id: string; nom: string }[]
      >();
      expect(liste.find((x) => x.id === id)?.nom).toBe('Ursule Fictif');
      const garde = await app.inject({
        method: 'POST',
        url: `${base}/epuises/garder`,
        payload: { ids: [id] },
      });
      expect(garde.json()).toEqual({ modifies: 1 });
      expect(
        (await app.inject({ method: 'GET', url: `${base}/epuises` }))
          .json<{ id: string }[]>()
          .some((x) => x.id === id),
      ).toBe(false);
      const mauvais = await app.inject({
        method: 'POST',
        url: `${base}/epuises/confirmer`,
        payload: { ids: ['pas-un-id'] },
      });
      expect(mauvais.statusCode).toBe(400);
    });
  });

  describe('réponse à une campagne (Inbox)', () => {
    it('reconnaît l’entrée liée à un mail de campagne et crée le brouillon de réponse', async () => {
      const [c] = await t.owner.db
        .insert(contacts)
        .values({ instanceId, nom: 'Valérie Joly', email: 'valerie@exemple.test' })
        .returning({ id: contacts.id });
      await t.owner.db.insert(prospectionOccurrences).values({
        instanceId,
        mode: 'relance',
        contactId: c!.id,
        contactNom: 'Valérie Joly',
        theme: 'Test de VMA',
        touche: 2,
        etat: 'envoye',
        envoyeAt: new Date(),
        threadId: 'ab12cd34ef56ab78',
      });
      const [su] = await t.owner.db
        .insert(sujets)
        .values({
          instanceId,
          type: 'mail_a_repondre',
          titre: 'Réponse',
          origine: 'messagerie',
          source: 'routine',
          sourceId: 'ab12cd34ef56ab78',
        })
        .returning({ id: sujets.id });
      const lire = await app.inject({ method: 'GET', url: `${base}/reponses/${su!.id}` });
      expect(lire.json<{ reponse: { contactNom: string } | null }>().reponse).toMatchObject({
        contactNom: 'Valérie Joly',
        touche: 2,
      });
      const cree = await app.inject({ method: 'POST', url: `${base}/reponses/${su!.id}/rediger` });
      expect(cree.statusCode).toBe(200);
      const camp = (
        await app.inject({
          method: 'GET',
          url: `${base}/campagnes/${cree.json<{ campagneId: string }>().campagneId}`,
        })
      ).json<CampagneVue>();
      expect(camp.mode).toBe('reponse');
      expect(camp.reglage.signatureId).toBeNull();
    });

    it('ne reconnaît rien pour une entrée sans campagne, et refuse de rédiger', async () => {
      const [su] = await t.owner.db
        .insert(sujets)
        .values({
          instanceId,
          type: 'mail_a_repondre',
          titre: 'Autre',
          origine: 'messagerie',
          source: 'routine',
          sourceId: 'zz-inconnu-0000',
        })
        .returning({ id: sujets.id });
      expect(
        (await app.inject({ method: 'GET', url: `${base}/reponses/${su!.id}` })).json(),
      ).toEqual({ reponse: null });
      expect(
        (await app.inject({ method: 'POST', url: `${base}/reponses/${su!.id}/rediger` }))
          .statusCode,
      ).toBe(400);
    });
  });
});
