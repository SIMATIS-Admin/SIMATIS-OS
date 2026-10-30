import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { contacts, entreprises, taches } from '../crm/schema.js';
import { withInstance } from '../db/context.js';
import { createInstance } from '../instances/service.js';
import {
  CampagneInvalide,
  creerCampagneRelance,
  lireCampagne,
  reglageParDefaut,
} from './campagnes.js';
import { prospectionOccurrences, type ReglageCampagne } from './schema.js';
import { ajouterSignature } from './signatures.js';

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(8)]);

describe('Campagnes de relance', () => {
  let t: TestApp;
  let a: string;
  let b: string;

  beforeAll(async () => {
    t = await setupTestApp();
    a = (await createInstance(t.owner.db, { slug: 'camp-a', nom: 'A', type: 'mandat' })).id;
    b = (await createInstance(t.owner.db, { slug: 'camp-b', nom: 'B', type: 'mandat' })).id;
  });
  afterAll(async () => {
    await t.drop();
  });

  const dansA = <T>(fn: Parameters<typeof withInstance<T>>[2]) => withInstance(t.app.db, a, fn);

  // Une tâche de relance par mail, avec son contact (adresse fictive).
  async function tache(
    instanceId: string,
    o: {
      nom: string;
      email?: string | null;
      fait?: boolean;
      sansContact?: boolean;
      canal?: 'email' | 'appel';
    },
  ) {
    const [e] = await t.owner.db
      .insert(entreprises)
      .values({ instanceId, nom: `Société ${o.nom}` })
      .returning({ id: entreprises.id });
    const [c] = o.sansContact
      ? [undefined]
      : await t.owner.db
          .insert(contacts)
          .values({
            instanceId,
            nom: o.nom,
            entrepriseId: e?.id,
            ...(o.email === null
              ? {}
              : { email: o.email ?? `${o.nom.toLowerCase().replace(/\W/g, '')}@exemple.test` }),
          })
          .returning({ id: contacts.id });
    const [tc] = await t.owner.db
      .insert(taches)
      .values({
        instanceId,
        titre: `Relancer ${o.nom}`,
        canal: o.canal ?? 'email',
        contactId: c?.id ?? null,
        entrepriseId: e?.id ?? null,
        echeance: new Date(),
        faitAt: o.fait ? new Date() : null,
      })
      .returning({ id: taches.id });
    return { tacheId: tc!.id, contactId: c?.id };
  }

  it('crée une campagne et un brouillon à rédiger par tâche valide', async () => {
    const x = await tache(a, { nom: 'Camille Marchand' });
    const y = await tache(a, { nom: 'Julien Roux' });
    const r = await dansA((tx) =>
      creerCampagneRelance(tx, { tacheIds: [x.tacheId, y.tacheId], reglage: reglageParDefaut() }),
    );
    expect(r.refusees).toEqual([]);
    const c = await dansA((tx) => lireCampagne(tx, r.campagneId));
    expect(c).toMatchObject({ mode: 'relance', statut: 'redaction' });
    expect(c.brouillons.map((b) => [b.contactNom, b.etat]).sort()).toEqual([
      ['Camille Marchand', 'a_rediger'],
      ['Julien Roux', 'a_rediger'],
    ]);
    expect(c.brouillons[0]?.societe).toContain('Société');
  });

  it("refuse une tâche faite, sans contact, sans email, d'appel ou d'une autre instance", async () => {
    const ok = await tache(a, { nom: 'Sophie Lefèvre' });
    const faite = await tache(a, { nom: 'Fait Déjà', fait: true });
    const sans = await tache(a, { nom: 'Sans Contact', sansContact: true });
    const mail = await tache(a, { nom: 'Sans Email', email: null });
    const appel = await tache(a, { nom: 'Par Téléphone', canal: 'appel' });
    const autre = await tache(b, { nom: 'Autre Instance' });
    const r = await dansA((tx) =>
      creerCampagneRelance(tx, {
        tacheIds: [ok, faite, sans, mail, appel, autre].map((x) => x.tacheId),
        reglage: reglageParDefaut(),
      }),
    );
    expect(r.refusees.map((x) => x.tacheId).sort()).toEqual(
      [faite, sans, mail, appel, autre].map((x) => x.tacheId).sort(),
    );
    expect(r.refusees.every((x) => x.raison.length > 0)).toBe(true);
    const c = await dansA((tx) => lireCampagne(tx, r.campagneId));
    expect(c.brouillons).toHaveLength(1);
  });

  it('ne crée pas de campagne vide quand toutes les tâches sont refusées', async () => {
    const faite = await tache(a, { nom: 'Fait Aussi', fait: true });
    await expect(
      dansA((tx) =>
        creerCampagneRelance(tx, { tacheIds: [faite.tacheId], reglage: reglageParDefaut() }),
      ),
    ).rejects.toBeInstanceOf(CampagneInvalide);
  });

  it('touche = 2 sans occurrence antérieure, +1 par mail déjà envoyé au même contact', async () => {
    const neuf = await tache(a, { nom: 'Premier Contact' });
    const relance = await tache(a, { nom: 'Déjà Relancé' });
    await t.owner.db.insert(prospectionOccurrences).values([
      {
        instanceId: a,
        mode: 'relance',
        contactId: relance.contactId,
        contactNom: 'Déjà Relancé',
        theme: 'Test de VMA',
        touche: 2,
        etat: 'envoye',
        envoyeAt: new Date(),
      },
      {
        instanceId: a,
        mode: 'relance',
        contactId: relance.contactId,
        contactNom: 'Déjà Relancé',
        theme: 'Test de VMA',
        touche: 3,
        etat: 'reponse',
        envoyeAt: new Date(),
      },
      // Un brouillon jamais envoyé ne compte pas.
      {
        instanceId: a,
        mode: 'relance',
        contactId: relance.contactId,
        contactNom: 'Déjà Relancé',
        theme: 'Test de VMA',
        touche: 4,
        etat: 'brouillon',
      },
    ]);
    const r = await dansA((tx) =>
      creerCampagneRelance(tx, {
        tacheIds: [neuf.tacheId, relance.tacheId],
        reglage: reglageParDefaut(),
      }),
    );
    const c = await dansA((tx) => lireCampagne(tx, r.campagneId));
    const touche = (nom: string) => c.brouillons.find((b) => b.contactNom === nom)?.touche;
    expect(touche('Premier Contact')).toBe(2);
    expect(touche('Déjà Relancé')).toBe(4);
  });

  it('refuse un réglage invalide', async () => {
    const x = await tache(a, { nom: 'Réglage Test' });
    const essai = (r: Partial<ReglageCampagne>) =>
      dansA((tx) =>
        creerCampagneRelance(tx, {
          tacheIds: [x.tacheId],
          reglage: { ...reglageParDefaut(), ...r },
        }),
      );
    await expect(essai({ offre: 'inconnue' as never })).rejects.toBeInstanceOf(CampagneInvalide);
    await expect(essai({ touchesMax: 0 })).rejects.toBeInstanceOf(CampagneInvalide);
    await expect(essai({ suivi: { type: 'date', date: '2020-01-01' } })).rejects.toBeInstanceOf(
      CampagneInvalide,
    );
    await expect(essai({ suivi: { type: 'date' } })).rejects.toBeInstanceOf(CampagneInvalide);
    await expect(
      essai({ signatureId: '00000000-0000-4000-8000-000000000000' }),
    ).rejects.toBeInstanceOf(CampagneInvalide);
    const autre = await withInstance(t.app.db, b, (tx) =>
      ajouterSignature(tx, {
        nom: 'Autre',
        typeMime: 'image/png',
        imageBase64: png.toString('base64'),
      }),
    );
    await expect(essai({ signatureId: autre.id })).rejects.toBeInstanceOf(CampagneInvalide);
  });

  it('accepte une signature de l’instance et une date de suivi à venir', async () => {
    const x = await tache(a, { nom: 'Réglage Valide' });
    const sig = await dansA((tx) =>
      ajouterSignature(tx, {
        nom: 'Ma signature',
        typeMime: 'image/png',
        imageBase64: png.toString('base64'),
      }),
    );
    const demain = new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10);
    const r = await dansA((tx) =>
      creerCampagneRelance(tx, {
        tacheIds: [x.tacheId],
        reglage: {
          ...reglageParDefaut(),
          signatureId: sig.id,
          suivi: { type: 'date', date: demain },
        },
      }),
    );
    const c = await dansA((tx) => lireCampagne(tx, r.campagneId));
    expect(c.reglage.signatureId).toBe(sig.id);
  });

  it('plafonne à 60 tâches par campagne', async () => {
    const ids = Array.from({ length: 61 }, () => '00000000-0000-4000-8000-000000000001');
    await expect(
      dansA((tx) => creerCampagneRelance(tx, { tacheIds: ids, reglage: reglageParDefaut() })),
    ).rejects.toBeInstanceOf(CampagneInvalide);
  });

  it("ne lit pas la campagne d'une autre instance", async () => {
    const x = await tache(a, { nom: 'Cloisonnement' });
    const r = await dansA((tx) =>
      creerCampagneRelance(tx, { tacheIds: [x.tacheId], reglage: reglageParDefaut() }),
    );
    await expect(
      withInstance(t.app.db, b, (tx) => lireCampagne(tx, r.campagneId)),
    ).rejects.toBeInstanceOf(CampagneInvalide);
  });
});
