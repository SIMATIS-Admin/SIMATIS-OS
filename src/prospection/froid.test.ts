import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insererFiche } from '../../test/fiche-base.js';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { baseVivante } from '../base-vivante/schema.js';
import { withInstance } from '../db/context.js';
import { createInstance } from '../instances/service.js';
import { CampagneInvalide, lireCampagne, reglageParDefaut } from './campagnes.js';
import {
  confirmerEpuises,
  contactsAConfirmer,
  creerCampagneFroid,
  echantillonFroid,
  garderContacts,
} from './froid.js';
import { prospectionSuiviFroid } from './schema.js';
import { statsProspection } from './stats.js';

describe('Prospection à froid', () => {
  let t: TestApp;
  let a: string;
  let b: string;

  beforeAll(async () => {
    t = await setupTestApp();
    a = (await createInstance(t.owner.db, { slug: 'froid-a', nom: 'A', type: 'mandat' })).id;
    b = (await createInstance(t.owner.db, { slug: 'froid-b', nom: 'B', type: 'mandat' })).id;
  });
  afterAll(async () => {
    await t.drop();
  });
  const dansA = <T>(fn: Parameters<typeof withInstance<T>>[2]) => withInstance(t.app.db, a, fn);

  let n = 0;
  async function fiche(
    o: Partial<typeof baseVivante.$inferInsert> = {},
    instanceId = a,
  ): Promise<string> {
    n += 1;
    const id = await insererFiche(t.owner.db, {
      instanceId,
      zone: 'prospectable',
      entreprise: `Atelier Fictif ${n}`,
      prenom: 'Camille',
      nom: `Dupré${n}`,
      email: `contact${n}@fictif.test`,
      fonction: 'Directeur',
      provenance: 'Salon fictif',
      ...o,
    });
    return id;
  }
  const suivi = async (baseId: string, v: Partial<typeof prospectionSuiviFroid.$inferInsert>) => {
    await t.owner.db.insert(prospectionSuiviFroid).values({ instanceId: a, baseId, ...v });
  };
  const il = (jours: number) => new Date(Date.now() - jours * 86400_000);

  describe('échantillon', () => {
    it('ne propose que les contacts prospectables, joignables et jamais contactés', async () => {
      const bon = await fiche();
      const exclus = [
        await fiche({ zone: 'a_enrichir' }),
        await fiche({ email: null }),
        await fiche({ emailInvalide: true }),
        await fiche({ opposition: true }),
        await fiche({ exclusion: 'client' }),
        await fiche({ statutProspection: 'a_repondu' }),
        // Déjà contacté par un autre biais (CRM d'un mandat, messagerie) : jamais en froid.
        await fiche({ statutProspection: 'contacte' }),
      ];
      await fiche({}, b);
      const ids = (await dansA((tx) => echantillonFroid(tx, { nombre: 500 }))).map((c) => c.id);
      expect(ids).toContain(bon);
      for (const id of exclus) expect(ids).not.toContain(id);
    });

    it('redonne un contact touché depuis plus de 14 jours qui n’a pas atteint son plafond', async () => {
      const ancien = await fiche();
      await suivi(ancien, { touches: 1, touchesMax: 4, derniereLe: il(20) });
      const recent = await fiche();
      await suivi(recent, { touches: 1, touchesMax: 4, derniereLe: il(3) });
      const plafond = await fiche();
      await suivi(plafond, { touches: 4, touchesMax: 4, derniereLe: il(30) });
      const epuise = await fiche();
      await suivi(epuise, { touches: 2, touchesMax: 4, derniereLe: il(30), statut: 'epuise' });
      const ids = (await dansA((tx) => echantillonFroid(tx, { nombre: 500 }))).map((c) => c.id);
      expect(ids).toContain(ancien);
      expect(ids).not.toContain(recent);
      expect(ids).not.toContain(plafond);
      expect(ids).not.toContain(epuise);
    });

    it('indique la touche à venir, filtre par texte et limite le nombre', async () => {
      const f = await fiche({ entreprise: 'Fonderie Zéphyr', nom: 'Zéphyr' });
      await suivi(f, { touches: 2, touchesMax: 4, derniereLe: il(40) });
      const r = await dansA((tx) => echantillonFroid(tx, { nombre: 10, filtre: 'zephyr' }));
      expect(r).toHaveLength(1);
      expect(r[0]).toMatchObject({ id: f, touche: 3, entreprise: 'Fonderie Zéphyr' });
      expect(await dansA((tx) => echantillonFroid(tx, { nombre: 3 }))).toHaveLength(3);
    });
  });

  describe('campagne', () => {
    it('crée un brouillon à rédiger par contact, avec la bonne touche', async () => {
      const neuf = await fiche({ prenom: 'Inès', nom: 'Marchand', entreprise: 'Usinage Fictif' });
      const deuxieme = await fiche();
      await suivi(deuxieme, { touches: 1, touchesMax: 4, derniereLe: il(30) });
      const r = await dansA((tx) =>
        creerCampagneFroid(tx, { baseIds: [neuf, deuxieme], reglage: reglageParDefaut() }),
      );
      expect(r.refusees).toEqual([]);
      const c = await dansA((tx) => lireCampagne(tx, r.campagneId));
      expect(c.mode).toBe('froid');
      const b1 = c.brouillons.find((x) => x.baseId === neuf)!;
      expect(b1).toMatchObject({
        contactNom: 'Inès Marchand',
        societe: 'Usinage Fictif',
        touche: 1,
        etat: 'a_rediger',
        tacheId: null,
        contactId: null,
      });
      expect(c.brouillons.find((x) => x.baseId === deuxieme)?.touche).toBe(2);
    });

    it('refuse un contact non éligible ou d’une autre instance, et ne crée pas de campagne vide', async () => {
      const sans = await fiche({ email: null });
      const autre = await fiche({}, b);
      const r = dansA((tx) =>
        creerCampagneFroid(tx, { baseIds: [sans, autre], reglage: reglageParDefaut() }),
      );
      await expect(r).rejects.toBeInstanceOf(CampagneInvalide);
      const ok = await fiche();
      const mixte = await dansA((tx) =>
        creerCampagneFroid(tx, { baseIds: [ok, sans], reglage: reglageParDefaut() }),
      );
      expect(mixte.refusees.map((x) => x.baseId)).toEqual([sans]);
    });
  });

  describe('contacts épuisés', () => {
    it('liste ceux qui ont atteint leur plafond, les confirme ou les garde', async () => {
      const f1 = await fiche({ prenom: 'Louis', nom: 'Roche' });
      const f2 = await fiche({ prenom: 'Mia', nom: 'Perret' });
      const encore = await fiche();
      await suivi(f1, { touches: 4, touchesMax: 4, derniereLe: il(30) });
      await suivi(f2, { touches: 3, touchesMax: 3, derniereLe: il(30) });
      await suivi(encore, { touches: 2, touchesMax: 4, derniereLe: il(30) });
      const liste = await dansA((tx) => contactsAConfirmer(tx));
      // D'autres contacts au plafond viennent des tests précédents : seuls f1 et f2 nous importent.
      expect(liste.map((c) => c.id)).toEqual(expect.arrayContaining([f1, f2]));
      expect(liste.find((c) => c.id === f1)).toMatchObject({ nom: 'Louis Roche', touches: 4 });
      expect((await dansA((tx) => statsProspection(tx))).aConfirmer).toBe(liste.length);

      await dansA((tx) => confirmerEpuises(tx, [f1]));
      await dansA((tx) => garderContacts(tx, [f2]));
      const apres = await dansA((tx) => contactsAConfirmer(tx));
      expect(apres.map((c) => c.id)).not.toContain(f1);
      expect(apres.map((c) => c.id)).not.toContain(f2);
      const lignes = await t.owner.db
        .select()
        .from(prospectionSuiviFroid)
        .where(eq(prospectionSuiviFroid.baseId, f2));
      expect(lignes[0]?.touchesMax).toBe(4);
      const ids = (await dansA((tx) => echantillonFroid(tx, { nombre: 500 }))).map((c) => c.id);
      expect(ids).not.toContain(f1);
      expect(ids).toContain(f2);
    });

    it('ne marque jamais un contact qui n’a pas atteint son plafond, ni celui d’une autre instance', async () => {
      const encore = await fiche();
      await suivi(encore, { touches: 1, touchesMax: 4, derniereLe: il(30) });
      await dansA((tx) => confirmerEpuises(tx, [encore]));
      const [l] = await t.owner.db
        .select()
        .from(prospectionSuiviFroid)
        .where(eq(prospectionSuiviFroid.baseId, encore));
      expect(l?.statut).toBe('actif');
      const etranger = await fiche({}, b);
      await t.owner.db
        .insert(prospectionSuiviFroid)
        .values({ instanceId: b, baseId: etranger, touches: 4, touchesMax: 4 });
      await dansA((tx) => confirmerEpuises(tx, [etranger]));
      const [e] = await t.owner.db
        .select()
        .from(prospectionSuiviFroid)
        .where(eq(prospectionSuiviFroid.baseId, etranger));
      expect(e?.statut).toBe('actif');
    });
  });
});
