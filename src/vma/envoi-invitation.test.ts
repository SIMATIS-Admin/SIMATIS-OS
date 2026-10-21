import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { envoyerInvitation, mailInvitation } from './invitations.js';

describe('Mail d’invitation au test VMA', () => {
  it('reprend le lien, le nom et la date, et échappe ce que l’on saisit', () => {
    const mail = mailInvitation({
      entrepriseNom: 'Atelier <b>Fictif</b>',
      contactNom: 'Jeanne "J"',
      lien: 'https://site.test/test-vma?i=abc',
      expireLe: new Date('2026-11-04T10:00:00.000Z'),
    });
    expect(mail.subject).toBe('Votre test VMA : Atelier <b>Fictif</b>');
    expect(mail.html).toContain('Bonjour Jeanne &quot;J&quot;,');
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
    expect(mail.html).toContain('<p>Bonjour,</p>');
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
});
