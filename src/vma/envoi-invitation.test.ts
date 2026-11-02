import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { randomBytes } from 'node:crypto';
import { vmaTests } from './schema.js';
import { envoyerInvitation, mailInvitation, mailRelance } from './invitations.js';

describe('Mail d’invitation au test VMA', () => {
  it('reprend le lien, le nom et la date, et échappe ce que l’on saisit', () => {
    const mail = mailInvitation({
      entrepriseNom: 'Atelier <b>Fictif</b>',
      contactNom: 'Jeanne DUPONT',
      lien: 'https://site.test/test-vma?i=abc',
      expireLe: new Date('2026-11-04T10:00:00.000Z'),
    });
    expect(mail.subject).toBe('Votre test VMA : Atelier <b>Fictif</b>');
    expect(mail.html).toContain('Bonjour Jeanne,');
    expect(mail.html).not.toContain('DUPONT');
    expect(mail.html).toContain('Atelier &lt;b&gt;Fictif&lt;/b&gt;');
    expect(mail.html).toContain('href="https://site.test/test-vma?i=abc"');
    expect(mail.html).not.toContain('<b>');
    expect(mail.html).toContain('expire le');
  });

  it('sans prénom du contact, la salutation reste générique', () => {
    const mail = mailInvitation({
      entrepriseNom: 'Atelier',
      contactNom: null,
      lien: 'https://site.test/test-vma?i=abc',
      expireLe: new Date('2026-11-04T10:00:00.000Z'),
    });
    expect(mail.html).toContain('>Bonjour,</p>');
  });
});

describe('Registre des mails (vouvoiement / tutoiement)', () => {
  const base = {
    entrepriseNom: 'Atelier Fictif',
    contactNom: 'Jeanne',
    lien: 'https://site.test/test-vma?i=abc',
    expireLe: new Date('2026-11-04T10:00:00.000Z'),
  };

  it('l’invitation vouvoie par défaut et tutoie à la demande', () => {
    expect(mailInvitation(base).html).toContain('Voici votre lien');
    const tu = mailInvitation({ ...base, tutoiement: true }).html;
    expect(tu).toContain('Voici ton lien');
    expect(tu).toContain('copie ce lien');
    expect(tu).not.toContain('votre lien');
  });

  it('la relance reprend le gabarit, le lien et l’expiration', () => {
    const mail = mailRelance({ ...base, entrepriseNom: 'Atelier <b>Fictif</b>' });
    expect(mail.subject).toBe('Rappel : votre test VMA (Atelier <b>Fictif</b>)');
    expect(mail.html).toContain('Bonjour Jeanne,');
    expect(mail.html).toContain('href="https://site.test/test-vma?i=abc"');
    expect(mail.html).toContain('expire le');
    expect(mail.html).toContain('Atelier &lt;b&gt;Fictif&lt;/b&gt;');
    expect(mail.html).not.toContain('<b>');
  });

  it('invitation et relance portent le pixel de suivi, tiré du lien', () => {
    const pixel =
      '<img src="https://site.test/api/test-vma/pixel?i=abc" width="1" height="1" alt="" style="display:block;border:0;">';
    expect(mailInvitation(base).html).toContain(pixel);
    expect(mailRelance(base).html).toContain(pixel);
  });

  it('sans lien du test reconnaissable, aucun pixel', () => {
    const html = mailInvitation({ ...base, lien: 'https://site.test/autre?x=1' }).html;
    expect(html).not.toContain('<img src="https://site.test/api');
  });

  it('la relance tutoie à la demande', () => {
    const mail = mailRelance({ ...base, tutoiement: true });
    expect(mail.subject).toBe('Rappel : ton test VMA (Atelier Fictif)');
    expect(mail.html).not.toContain('votre');
  });
});

describe('Envoi de l’invitation par la messagerie', () => {
  let t: TestApp;
  let mandat: Instance;
  const test = {
    entrepriseNom: 'Atelier Fictif',
    contactNom: 'Jeanne',
    contactEmail: 'jeanne@exemple.test',
    lien: 'https://site.test/test-vma?i=abc',
    expireLe: new Date('2026-11-04T10:00:00.000Z'),
  };

  beforeAll(async () => {
    t = await setupTestApp();
    mandat = await createInstance(t.owner.db, {
      slug: 'vma-envoi',
      nom: 'Mandat envoi',
      type: 'mandat',
    });
  });

  afterAll(async () => {
    await t.drop();
  });

  it('sans messagerie configurée, l’envoi échoue sans bloquer : la raison est rendue', async () => {
    const envoi = await envoyerInvitation(
      t.app.db,
      mandat,
      { secretsDir: './secrets/inexistant', realWrites: false },
      test,
    );
    expect(envoi.statut).toBe('echec');
    expect(envoi.raison).toMatch(/messagerie/);
  });

  it('sans adresse du contact, rien n’est tenté', async () => {
    const envoi = await envoyerInvitation(
      t.app.db,
      mandat,
      { secretsDir: './secrets/inexistant', realWrites: false },
      { ...test, contactEmail: null },
    );
    expect(envoi).toEqual({ statut: 'echec', raison: 'aucune adresse e-mail' });
  });

  it('un échec est consigné sur l’invitation, sans date d’envoi', async () => {
    const [ligne] = await t.owner.db
      .insert(vmaTests)
      .values({
        instanceId: mandat.id,
        entrepriseNom: 'Atelier Fictif',
        contactEmail: 'jeanne@exemple.test',
        type: 'essai',
        invitationId: randomBytes(16).toString('hex'),
        lien: test.lien,
        expireLe: test.expireLe,
      })
      .returning();
    const envoi = await envoyerInvitation(
      t.app.db,
      mandat,
      { secretsDir: './secrets/inexistant', realWrites: false },
      { ...test, id: ligne!.id },
    );
    expect(envoi.statut).toBe('echec');
    const [apres] = await t.owner.db.select().from(vmaTests);
    expect(apres?.echecEnvoi).toMatch(/messagerie/);
    expect(apres?.envoyeeLe).toBeNull();
  });
});
