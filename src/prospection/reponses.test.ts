import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { insererFiche } from '../../test/fiche-base.js';
import { configureConnexion, registerConnector } from '../connexions/service.js';
import { contacts, taches } from '../crm/schema.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { sujets } from '../inbox/schema.js';
import { CampagneInvalide, lireCampagne, reglageParDefaut } from './campagnes.js';
import { finaliserCampagne } from './finalisation.js';
import { demarrerCampagne, deposerBrouillons } from './redaction.js';
import { creerCampagneReponse, reponseDeSujet } from './reponses.js';
import { prospectionOccurrences, prospectionSuiviFroid } from './schema.js';

const ecrits: { op: string; data: Record<string, unknown> }[] = [];
registerConnector({
  fournisseur: 'boite-test',
  sync: () => Promise.resolve({ lus: 0, crees: 0, maj: 0, erreurs: [] }),
  write: (ctx, op) => {
    if (!ctx.reel) return Promise.resolve({ simulation: true });
    ecrits.push(op);
    return Promise.resolve({ simulation: false, id: `draft-${ecrits.length}` });
  },
});

describe('Réponses aux campagnes depuis l’Inbox', () => {
  let t: TestApp;
  let instance: Instance;
  let autre: Instance;
  let secretsDir: string;

  beforeAll(async () => {
    t = await setupTestApp();
    instance = await createInstance(t.owner.db, {
      slug: 'rep-a',
      nom: 'A',
      type: 'mandat',
      config: { ecrituresReelles: true },
    });
    autre = await createInstance(t.owner.db, { slug: 'rep-b', nom: 'B', type: 'mandat' });
    secretsDir = await mkdtemp(path.join(tmpdir(), 'simatis-rep-'));
    await withInstance(t.app.db, instance.id, (tx) =>
      configureConnexion(tx, { kind: 'messagerie', fournisseur: 'boite-test' }),
    );
  });
  afterAll(async () => {
    await t.drop();
    await rm(secretsDir, { recursive: true, force: true });
  });
  const dans = <T>(fn: Parameters<typeof withInstance<T>>[2]) =>
    withInstance(t.app.db, instance.id, fn);

  let n = 0;
  async function sujet(
    o: {
      sourceId?: string;
      lien?: string;
      type?: 'mail_a_repondre' | 'devis';
      instanceId?: string;
    } = {},
  ) {
    n += 1;
    const [s] = await t.owner.db
      .insert(sujets)
      .values({
        instanceId: o.instanceId ?? instance.id,
        type: o.type ?? 'mail_a_repondre',
        titre: `Réponse ${n}`,
        origine: 'messagerie',
        source: 'routine',
        sourceId: o.sourceId ?? `fil-${n}`,
        ...(o.lien ? { lien: o.lien } : {}),
      })
      .returning({ id: sujets.id });
    return s!.id;
  }
  async function occurrence(o: {
    threadId: string;
    contactId?: string | null;
    baseId?: string | null;
    mode?: 'relance' | 'froid';
    touche?: number;
    etat?: 'brouillon' | 'envoye';
  }) {
    const [r] = await t.owner.db
      .insert(prospectionOccurrences)
      .values({
        instanceId: instance.id,
        mode: o.mode ?? 'relance',
        contactId: o.contactId ?? null,
        baseId: o.baseId ?? null,
        contactNom: 'Camille Marchand',
        societe: 'Atelier Fictif',
        theme: 'Test de VMA',
        touche: o.touche ?? 2,
        etat: o.etat ?? 'envoye',
        threadId: o.threadId,
        ...(o.etat === 'brouillon' ? {} : { envoyeAt: new Date() }),
      })
      .returning({ id: prospectionOccurrences.id });
    return r!.id;
  }
  const contact = async (nom = 'Camille Marchand') =>
    (
      await t.owner.db
        .insert(contacts)
        .values({
          instanceId: instance.id,
          nom,
          email: `${nom.toLowerCase().replace(/\W/g, '')}@exemple.test`,
        })
        .returning({ id: contacts.id })
    )[0]!.id;

  describe('détection', () => {
    it('reconnaît une réponse à une campagne par la clé du fil ou par le lien', async () => {
      const c = await contact();
      const occ = await occurrence({ threadId: '18f3a9c2d4e5b678', contactId: c });
      const parCle = await sujet({ sourceId: '18f3a9c2d4e5b678' });
      const parLien = await sujet({
        sourceId: 'autre',
        lien: 'https://mail.google.com/mail/u/0/#inbox/18f3a9c2d4e5b678',
      });
      for (const id of [parCle, parLien]) {
        const r = await dans((tx) => reponseDeSujet(tx, id));
        expect(r).toMatchObject({
          occurrenceId: occ,
          contactNom: 'Camille Marchand',
          theme: 'Test de VMA',
          touche: 2,
          mode: 'relance',
        });
      }
    });

    it('ne reconnaît rien pour un autre type d’entrée, un fil inconnu ou un autre espace', async () => {
      await occurrence({ threadId: 'aaaa1111bbbb2222' });
      const devis = await sujet({ sourceId: 'aaaa1111bbbb2222', type: 'devis' });
      expect(await dans((tx) => reponseDeSujet(tx, devis))).toBeNull();
      const inconnu = await sujet({ sourceId: 'fil-inconnu-123456' });
      expect(await dans((tx) => reponseDeSujet(tx, inconnu))).toBeNull();
      const etranger = await sujet({ sourceId: 'aaaa1111bbbb2222', instanceId: autre.id });
      expect(
        await withInstance(t.app.db, autre.id, (tx) => reponseDeSujet(tx, etranger)),
      ).toBeNull();
    });

    it('prend l’occurrence la plus récente du fil', async () => {
      const c = await contact('Julien Roux');
      await occurrence({ threadId: 'cccc3333dddd4444', contactId: c, touche: 2 });
      const recente = await occurrence({ threadId: 'cccc3333dddd4444', contactId: c, touche: 3 });
      await t.owner.db
        .update(prospectionOccurrences)
        .set({ createdAt: new Date(Date.now() - 86400_000) })
        .where(eq(prospectionOccurrences.touche, 2));
      const r = await dans(async (tx) =>
        reponseDeSujet(tx, await sujet({ sourceId: 'cccc3333dddd4444' })),
      );
      expect(r?.occurrenceId).toBe(recente);
    });
  });

  describe('création du brouillon de réponse', () => {
    it('crée une campagne « réponse » avec le fil et le contact, et sort le contact de la séquence', async () => {
      const c = await contact('Sophie Lefèvre');
      const occ = await occurrence({
        threadId: 'eeee5555ffff6666',
        contactId: c,
        touche: 2,
        etat: 'brouillon',
      });
      const s = await sujet({ sourceId: 'eeee5555ffff6666' });
      const r = await dans((tx) =>
        creerCampagneReponse(tx, { sujetId: s, reglage: reglageParDefaut() }),
      );
      const camp = await dans((tx) => lireCampagne(tx, r.campagneId));
      expect(camp).toMatchObject({ mode: 'reponse', statut: 'redaction' });
      expect(camp.brouillons).toHaveLength(1);
      expect(camp.brouillons[0]).toMatchObject({
        contactNom: 'Camille Marchand',
        contactEmail: 'sophielefvre@exemple.test',
        threadId: 'eeee5555ffff6666',
        touche: 3,
        sujetId: s,
        etat: 'a_rediger',
      });
      const [o] = await t.owner.db
        .select()
        .from(prospectionOccurrences)
        .where(eq(prospectionOccurrences.id, occ));
      expect(o?.etat).toBe('reponse');
      expect(o?.envoyeAt).not.toBeNull();
    });

    it('à froid : le contact de la base quitte la séquence (répondu)', async () => {
      const baseId = await insererFiche(t.owner.db, {
        instanceId: instance.id,
        zone: 'prospectable',
        entreprise: 'Atelier Fictif',
        prenom: 'Louis',
        nom: 'Roche',
        email: 'louis@fictif.test',
        provenance: 'Salon fictif',
      });
      await t.owner.db.insert(prospectionSuiviFroid).values({
        instanceId: instance.id,
        baseId,
        touches: 1,
        touchesMax: 4,
        derniereLe: new Date(),
      });
      await occurrence({ threadId: '1111aaaa2222bbbb', baseId, mode: 'froid', touche: 1 });
      const s = await sujet({ sourceId: '1111aaaa2222bbbb' });
      const r = await dans((tx) =>
        creerCampagneReponse(tx, { sujetId: s, reglage: reglageParDefaut() }),
      );
      expect((await dans((tx) => lireCampagne(tx, r.campagneId))).brouillons[0]?.contactEmail).toBe(
        'louis@fictif.test',
      );
      const [l] = await t.owner.db
        .select()
        .from(prospectionSuiviFroid)
        .where(eq(prospectionSuiviFroid.baseId, baseId));
      expect(l?.statut).toBe('repondu');
    });

    it('rend la campagne déjà ouverte pour la même entrée (pas de doublon)', async () => {
      const c = await contact('Paul Giraud');
      await occurrence({ threadId: '3333cccc4444dddd', contactId: c });
      const s = await sujet({ sourceId: '3333cccc4444dddd' });
      const un = await dans((tx) =>
        creerCampagneReponse(tx, { sujetId: s, reglage: reglageParDefaut() }),
      );
      const deux = await dans((tx) =>
        creerCampagneReponse(tx, { sujetId: s, reglage: reglageParDefaut() }),
      );
      expect(deux.campagneId).toBe(un.campagneId);
    });

    it('refuse une entrée qui ne répond à aucune campagne', async () => {
      await expect(
        dans(async (tx) =>
          creerCampagneReponse(tx, {
            sujetId: await sujet({ sourceId: 'rien-a-voir-1234' }),
            reglage: reglageParDefaut(),
          }),
        ),
      ).rejects.toBeInstanceOf(CampagneInvalide);
    });
  });

  describe('finalisation', () => {
    async function prete(nom: string, threadId: string) {
      const c = await contact(nom);
      await occurrence({ threadId, contactId: c });
      const s = await sujet({ sourceId: threadId });
      return dans(async (tx) => {
        const r = await creerCampagneReponse(tx, { sujetId: s, reglage: reglageParDefaut() });
        await demarrerCampagne(tx, r.campagneId);
        const [b] = (await lireCampagne(tx, r.campagneId)).brouillons;
        // Claude ne renvoie pas toujours le fil : celui de l'entrée est conservé.
        await deposerBrouillons(tx, r.campagneId, [
          { id: b!.id, objet: 'Re: votre réponse', corps: '<p>Bonjour,</p><p>Bien à vous,</p>' },
        ]);
        return { campagneId: r.campagneId, contactId: c, nom: 'Camille Marchand' };
      });
    }

    it('crée le brouillon dans le fil, sans nouvelle occurrence, et clôt le suivi en attente', async () => {
      ecrits.length = 0;
      const { campagneId, contactId } = await prete('Hugo Perret', '5555eeee6666ffff');
      const [suivi] = await t.owner.db
        .insert(taches)
        .values({
          instanceId: instance.id,
          titre: 'RELANCE de prospection (MAIL) : Camille Marchand',
          canal: 'email',
          contactId,
          echeance: new Date(Date.now() + 20 * 86400_000),
        })
        .returning({ id: taches.id });
      const avant = (
        await t.owner.db
          .select()
          .from(prospectionOccurrences)
          .where(eq(prospectionOccurrences.instanceId, instance.id))
      ).length;
      const r = await finaliserCampagne(t.app.db, instance, campagneId, {
        secretsDir,
        realWrites: true,
      });
      expect(r).toMatchObject({
        brouillons: 1,
        simulation: false,
        envoye: false,
        suivisCrees: 1,
        faites: 1,
      });
      expect(ecrits).toHaveLength(1);
      expect(ecrits[0]?.op).toBe('draft.create');
      expect(ecrits[0]?.data).toMatchObject({
        to: 'hugoperret@exemple.test',
        threadId: '5555eeee6666ffff',
      });
      expect(
        (
          await t.owner.db
            .select()
            .from(prospectionOccurrences)
            .where(eq(prospectionOccurrences.instanceId, instance.id))
        ).length,
      ).toBe(avant);
      const [ancien] = await t.owner.db
        .select({ faitAt: taches.faitAt })
        .from(taches)
        .where(eq(taches.id, suivi!.id));
      expect(ancien?.faitAt).not.toBeNull();
      const nouveaux = await t.owner.db
        .select({ titre: taches.titre })
        .from(taches)
        .where(and(eq(taches.instanceId, instance.id), eq(taches.contactId, contactId)));
      expect(nouveaux.map((x) => x.titre)).toContain(
        'Suite de la réponse (MAIL) : Camille Marchand',
      );
    });

    it('n’envoie jamais directement une réponse', async () => {
      const { campagneId } = await prete('Léa Vasseur', '7777aaaa8888bbbb');
      await expect(
        finaliserCampagne(
          t.app.db,
          instance,
          campagneId,
          { secretsDir, realWrites: true },
          { envoi: true },
        ),
      ).rejects.toThrow(/brouillon/i);
    });
  });
});
