import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import type { Message } from '../connecteurs/google/google.js';
import type { Messagerie } from '../connecteurs/messagerie.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { mailsDeFiche, mailsEchanges } from './mails.js';

const deps = { secretsDir: '/inexistant', realWrites: false };

const message = (id: string, de: string, date: string | null, objet = 'Sujet fictif'): Message => ({
  id,
  date,
  de,
  a: null,
  objet,
  extrait: `Extrait ${id}`,
});

const boiteDe = (
  parAdresse: Record<string, Message[]>,
  compte = 'moi@exemple.test',
): Messagerie => ({
  historique: (email) => Promise.resolve(parAdresse[email] ?? []),
  filsRecents: () => Promise.resolve([]),
  brouillons: () => Promise.resolve([]),
  compte: () => Promise.resolve(compte),
});

describe('Mails échangés avec une fiche', () => {
  describe('mailsEchanges', () => {
    it('distingue envoyés et reçus, trie du plus récent au plus ancien et écarte les doublons', async () => {
      const boite = boiteDe({
        'a@exemple.test': [
          message('m1', 'Moi <MOI@exemple.test>', 'Mon, 05 Oct 2026 09:00:00 +0000', 'Relance 1'),
          message(
            'm2',
            'Agathe <a@exemple.test>',
            'Tue, 06 Oct 2026 09:00:00 +0000',
            'Re: Relance 1',
          ),
        ],
        'b@exemple.test': [
          message(
            'm2',
            'Agathe <a@exemple.test>',
            'Tue, 06 Oct 2026 09:00:00 +0000',
            'Re: Relance 1',
          ),
        ],
      });
      const { mails } = await mailsEchanges([boite], ['a@exemple.test', 'b@exemple.test']);
      expect(mails.map((m) => [m.texte, m.titre, m.type])).toEqual([
        ['Extrait m2', 'Reçu · Re: Relance 1', 'email'],
        ['Extrait m1', 'Envoyé · Relance 1', 'email'],
      ]);
      expect(mails[1]?.texte).toBe('Extrait m1');
    });

    it('charge uniquement le message autorisé de la fiche et conserve le fil et les participants', async () => {
      const m = {
        ...message('m1', 'contact@exemple.test', 'Tue, 06 Oct 2026 09:00:00 +0000'),
        threadId: 't1',
        inReplyTo: '<original@exemple.test>',
        a: 'moi@exemple.test',
      };
      const lire = vi.fn().mockResolvedValue({ ...m, html: '<p>Complet</p>' });
      const boite = { ...boiteDe({ 'contact@exemple.test': [m] }), message: lire };
      const first = await mailsEchanges([boite], ['contact@exemple.test']);
      expect(lire).not.toHaveBeenCalled();
      expect(first.mails[0]?.mail).toMatchObject({
        fil: 'moi@exemple.test:t1',
        de: m.de,
        a: m.a,
        sens: 'recu',
        reponse: true,
      });
      await mailsEchanges([boite], ['contact@exemple.test'], 'mail-autre-m1');
      expect(lire).not.toHaveBeenCalled();
      const result = await mailsEchanges([boite], ['contact@exemple.test'], first.mails[0]!.id);
      expect(lire).toHaveBeenCalledExactlyOnceWith('m1');
      expect(result.mails[0]?.mail).toMatchObject({ html: '<p>Complet</p>', charge: true });
    });

    it('ignore un mail sans date lisible et nomme un mail sans objet', async () => {
      const boite = boiteDe({
        'a@exemple.test': [
          message('m1', 'x@exemple.test', null),
          message('m2', 'x@exemple.test', 'pas une date'),
          { ...message('m3', 'x@exemple.test', 'Tue, 06 Oct 2026 09:00:00 +0000'), objet: null },
        ],
      });
      const { mails } = await mailsEchanges([boite], ['a@exemple.test']);
      expect(mails.map((m) => m.titre)).toEqual(['Reçu · (sans objet)']);
    });
  });

  describe('deux boîtes', () => {
    const messageDe = (id: string, de: string) =>
      message(id, de, 'Tue, 06 Oct 2026 09:00:00 +0000', `Objet ${id}`);

    it('réunit les mails des deux boîtes en indiquant la boîte de chacun', async () => {
      const simatis = boiteDe(
        { 'a@exemple.test': [messageDe('m1', 'moi@exemple.test')] },
        'moi@exemple.test',
      );
      const marque = boiteDe(
        { 'a@exemple.test': [messageDe('m2', 'a@exemple.test')] },
        'marque@exemple.test',
      );
      const { mails, erreurs } = await mailsEchanges([simatis, marque], ['a@exemple.test']);
      expect(erreurs).toEqual([]);
      expect(mails.map((m) => [m.texte, m.titre?.split(' · ')[0], m.compte]).sort()).toEqual([
        ['Extrait m1', 'Envoyé', 'moi@exemple.test'],
        ['Extrait m2', 'Reçu', 'marque@exemple.test'],
      ]);
    });

    it('garde une ligne par boîte quand un même mail est dans les deux', async () => {
      const commun = messageDe('m1', 'a@exemple.test');
      const un = boiteDe({ 'a@exemple.test': [commun] }, 'un@exemple.test');
      const deux = boiteDe({ 'a@exemple.test': [commun] }, 'deux@exemple.test');
      const { mails } = await mailsEchanges([un, deux], ['a@exemple.test']);
      expect(mails.map((m) => m.compte).sort()).toEqual(['deux@exemple.test', 'un@exemple.test']);
    });

    it('une boîte en panne ne cache pas l’autre', async () => {
      const bonne = boiteDe({ 'a@exemple.test': [messageDe('m1', 'a@exemple.test')] });
      const cassee: Messagerie = {
        ...boiteDe({}),
        compte: () => Promise.reject(new Error('jeton expiré')),
      };
      const { mails, erreurs } = await mailsEchanges([cassee, bonne], ['a@exemple.test']);
      expect(mails).toHaveLength(1);
      expect(erreurs).toEqual(['jeton expiré']);
    });
  });

  describe('mailsDeFiche', () => {
    let t: TestApp;
    let a: Instance;
    let b: Instance;
    const insert = async (sql: string, params: unknown[]) =>
      (await t.owner.pool.query<{ id: string }>(sql, params)).rows[0]!.id;
    const contact = (i: Instance, nom: string, email: string | null) =>
      insert('insert into contacts (instance_id, nom, email) values ($1, $2, $3) returning id', [
        i.id,
        nom,
        email,
      ]);

    beforeAll(async () => {
      t = await setupTestApp();
      a = await createInstance(t.owner.db, { slug: 'mails-a', nom: 'A', type: 'mandat' });
      b = await createInstance(t.owner.db, { slug: 'mails-b', nom: 'B', type: 'mandat' });
    });
    afterAll(() => t.drop());

    it('lit les mails de toutes les adresses d’un contact', async () => {
      const id = await contact(a, 'Contact Fictif', 'un@exemple.test');
      await t.owner.pool.query(
        'insert into contact_emails (instance_id, contact_id, email) values ($1, $2, $3)',
        [a.id, id, 'deux@exemple.test'],
      );
      const boite = boiteDe({
        'un@exemple.test': [message('m1', 'un@exemple.test', 'Tue, 06 Oct 2026 09:00:00 +0000')],
        'deux@exemple.test': [message('m2', 'moi@exemple.test', 'Wed, 07 Oct 2026 09:00:00 +0000')],
      });
      const r = await mailsDeFiche(t.app.db, a, 'contact', id, deps, () =>
        Promise.resolve([boite]),
      );
      expect(r.adresses).toBe(2);
      expect(r.mails.map((m) => m.texte)).toEqual(['Extrait m2', 'Extrait m1']);
    });

    it('une organisation rassemble les mails de ses contacts', async () => {
      const entreprise = await insert(
        'insert into entreprises (instance_id, nom) values ($1, $2) returning id',
        [a.id, 'Organisation Fictive'],
      );
      for (const email of ['p1@exemple.test', 'p2@exemple.test']) {
        const c = await contact(a, `Membre ${email}`, email);
        await t.owner.pool.query(
          'insert into contact_entreprises (instance_id, contact_id, entreprise_id) values ($1, $2, $3)',
          [a.id, c, entreprise],
        );
      }
      const boite = boiteDe({
        'p1@exemple.test': [message('m1', 'p1@exemple.test', 'Tue, 06 Oct 2026 09:00:00 +0000')],
        'p2@exemple.test': [message('m2', 'p2@exemple.test', 'Wed, 07 Oct 2026 09:00:00 +0000')],
      });
      const r = await mailsDeFiche(t.app.db, a, 'entreprise', entreprise, deps, () =>
        Promise.resolve([boite]),
      );
      expect(r.mails.map((m) => m.texte)).toEqual(['Extrait m2', 'Extrait m1']);
    });

    it('explique pourquoi il n’y a rien : pas d’adresse, pas de messagerie, messagerie en erreur', async () => {
      const sans = await contact(a, 'Sans Adresse', null);
      expect(
        (await mailsDeFiche(t.app.db, a, 'contact', sans, deps, () => Promise.resolve([]))).message,
      ).toBe('Aucune adresse email sur cette fiche.');

      const id = await contact(a, 'Avec Adresse', 'x@exemple.test');
      const absente = await mailsDeFiche(t.app.db, a, 'contact', id, deps, () =>
        Promise.resolve([]),
      );
      expect(absente.mails).toEqual([]);
      expect(absente.message).toMatch(/Aucune messagerie connectée/);

      const cassee: Messagerie = {
        ...boiteDe({}),
        historique: () => Promise.reject(new Error('jeton expiré')),
      };
      const erreur = await mailsDeFiche(t.app.db, a, 'contact', id, deps, () =>
        Promise.resolve([cassee]),
      );
      expect(erreur).toMatchObject({ mails: [], message: 'Mails non lus : jeton expiré' });
    });

    it('sans messagerie branchée sur l’instance, rien n’est lu', async () => {
      const id = await contact(b, 'Contact B', 'b@exemple.test');
      const r = await mailsDeFiche(t.app.db, b, 'contact', id, deps);
      expect(r.mails).toEqual([]);
      expect(r.message).toMatch(/Aucune messagerie connectée/);
    });

    it('ne lit jamais les contacts d’une autre instance', async () => {
      const autre = await contact(b, 'Autre', 'autre@exemple.test');
      const r = await mailsDeFiche(t.app.db, a, 'contact', autre, deps, () =>
        Promise.resolve([boiteDe({})]),
      );
      expect(r).toMatchObject({ adresses: 0, mails: [] });
    });
  });
});
