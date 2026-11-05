import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { configureConnexion, registerConnector } from '../connexions/service.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { contacts, entreprises, opportunites } from '../crm/schema.js';
import { getFiche } from '../crm/fiches.js';
import { contactsVma, rattacherContactVma, retirerAccordVma } from './contacts.js';
import { releverInscriptionsVma } from './inscriptions.js';
import { creerLienProspectionVma, envoyerInvitation, mailInvitation } from './invitations.js';

const ecrits: unknown[] = [];
registerConnector({
  fournisseur: 'messagerie-inscriptions-fictive',
  sync: () => Promise.resolve({ lus: 0, crees: 0, maj: 0, erreurs: [] }),
  write: (ctx, op) => {
    if (!ctx.reel) return Promise.resolve({ simulation: true });
    ecrits.push(op);
    return Promise.resolve({ simulation: false, id: 'message-fictif' });
  },
});
const maintenant = new Date();
const inscription = {
  invitation: 'a'.repeat(32),
  entreprise: 'Organisation fictive',
  prenom: 'Camille',
  nom: 'Exemple',
  poste: 'Direction',
  email: 'camille@exemple.test',
  telephone: null,
  creeLe: maintenant.toISOString(),
  expireLe: new Date(maintenant.getTime() + 86400000).toISOString(),
  consentement: {
    accepteLe: maintenant.toISOString(),
    version: 'v1',
    texte: 'Accord commercial fictif',
  },
};

describe('Inscriptions VMA et rattachements CRM', () => {
  let t: TestApp;
  let instance: Instance;
  let autre: Instance;
  let secretsDir: string;
  beforeAll(async () => {
    t = await setupTestApp();
    instance = await createInstance(t.owner.db, {
      slug: 'inscriptions-vma',
      nom: 'Activité fictive',
      type: 'propre',
      config: { ecrituresReelles: true },
    });
    autre = await createInstance(t.owner.db, {
      slug: 'autre-vma',
      nom: 'Autre instance fictive',
      type: 'mandat',
    });
    secretsDir = await mkdtemp(path.join(tmpdir(), 'vma-inscriptions-'));
    await withInstance(t.app.db, instance.id, (tx) =>
      configureConnexion(tx, {
        kind: 'messagerie',
        fournisseur: 'messagerie-inscriptions-fictive',
      }),
    );
  });
  afterAll(async () => {
    await t.drop();
  });
  beforeEach(async () => {
    await t.owner.pool.query('delete from vma_tests');
    ecrits.length = 0;
  });
  const fauxSite = (lignes: unknown[] = [inscription], ackOk = true) => {
    const ack: unknown[] = [];
    const http = ((_url: unknown, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        ack.push(JSON.parse(typeof init.body === 'string' ? init.body : '{}'));
        return Promise.resolve(new Response('{}', { status: ackOk ? 200 : 503 }));
      }
      return Promise.resolve(Response.json({ inscriptions: lignes }));
    }) as typeof fetch;
    return {
      ack,
      deps: {
        url: 'https://site.test',
        token: 'jeton-fictif',
        fetch: http,
        ecriture: { secretsDir, realWrites: true },
      },
    };
  };
  it('importe les coordonnées et la preuve puis envoie une seule fois malgré un rejeu', async () => {
    const site = fauxSite();
    await releverInscriptionsVma(t.app.db, site.deps);
    await releverInscriptionsVma(t.app.db, site.deps);
    const lignes = await contactsVma(t.app.db, instance.id);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({
      origine: 'inscription',
      contactPrenom: 'Camille',
      contactNomFamille: 'Exemple',
      contactPoste: 'Direction',
      consentement: inscription.consentement,
      contactId: null,
      entrepriseId: null,
      contactTelephone: null,
    });
    expect(lignes[0]?.envoyeeLe).not.toBeNull();
    expect(ecrits).toHaveLength(1);
    expect(JSON.stringify(ecrits)).toContain('Conformément à votre demande');
    expect(site.ack).toEqual([
      { ids: [inscription.invitation] },
      { ids: [inscription.invitation] },
    ]);
    expect(await contactsVma(t.app.db, autre.id)).toEqual([]);
  });
  it('conserve la demande si l’acquittement échoue puis la reprend sans doublon', async () => {
    await expect(
      releverInscriptionsVma(t.app.db, fauxSite([inscription], false).deps),
    ).rejects.toThrow('acquittement');
    expect(await contactsVma(t.app.db, instance.id)).toHaveLength(1);
    await releverInscriptionsVma(t.app.db, fauxSite().deps);
    expect(ecrits).toHaveLength(1);
  });
  it('en simulation la ligne existe mais aucune date d’envoi réel n’est enregistrée', async () => {
    const { deps } = fauxSite();
    deps.ecriture.realWrites = false;
    await releverInscriptionsVma(t.app.db, deps);
    expect((await contactsVma(t.app.db, instance.id))[0]?.envoyeeLe).toBeNull();
    expect(ecrits).toEqual([]);
    // Même après acquittement, un prochain passage peut envoyer les demandes en attente.
    await releverInscriptionsVma(t.app.db, fauxSite([]).deps);
    expect(ecrits).toHaveLength(1);
  });
  it('ne consomme pas une demande sans poste ou sans preuve d’accord', async () => {
    const site = fauxSite([{ ...inscription, poste: '' }]);
    await expect(releverInscriptionsVma(t.app.db, site.deps)).rejects.toThrow();
    expect(site.ack).toEqual([]);
    expect(await contactsVma(t.app.db, instance.id)).toEqual([]);
  });
  it('rattache uniquement des fiches de la même instance et conserve le retrait', async () => {
    await releverInscriptionsVma(t.app.db, fauxSite().deps);
    const test = (await contactsVma(t.app.db, instance.id))[0]!;
    const [e] = await t.owner.db
      .insert(entreprises)
      .values({ instanceId: instance.id, nom: 'Entreprise fictive liée' })
      .returning();
    const [c] = await t.owner.db
      .insert(contacts)
      .values({ instanceId: instance.id, nom: 'Camille Exemple', entrepriseId: e!.id })
      .returning();
    const [etranger] = await t.owner.db
      .insert(contacts)
      .values({ instanceId: autre.id, nom: 'Autre personne' })
      .returning();
    await expect(
      rattacherContactVma(t.app.db, instance.id, test.id, { contactId: etranger!.id }),
    ).rejects.toThrow('cette instance');
    await rattacherContactVma(t.app.db, instance.id, test.id, {
      contactId: c!.id,
      entrepriseId: e!.id,
    });
    const [affaire] = await t.owner.db
      .insert(opportunites)
      .values({ instanceId: instance.id, titre: 'Affaire fictive', etape: 'detection' })
      .returning();
    const [externe] = await t.owner.db
      .insert(opportunites)
      .values({ instanceId: autre.id, titre: 'Autre affaire fictive', etape: 'detection' })
      .returning();
    await expect(
      rattacherContactVma(t.app.db, instance.id, test.id, { opportuniteId: externe!.id }),
    ).rejects.toThrow('cette instance');
    await rattacherContactVma(t.app.db, instance.id, test.id, { opportuniteId: affaire!.id });
    for (const [kind, id] of [
      ['affaire', affaire!.id],
      ['contact', c!.id],
      ['entreprise', e!.id],
    ] as const) {
      expect((await getFiche(t.app.db, instance, kind, id))?.testsVma?.map((t) => t.id)).toEqual([
        test.id,
      ]);
    }
    await rattacherContactVma(t.app.db, instance.id, test.id, { opportuniteId: null });
    expect((await getFiche(t.app.db, instance, 'affaire', affaire!.id))?.testsVma).toEqual([]);
    await retirerAccordVma(t.app.db, instance.id, test.id);
    const apres = (await contactsVma(t.app.db, instance.id))[0]!;
    expect(apres.contactLie?.id).toBe(c!.id);
    expect(apres.entrepriseLiee?.id).toBe(e!.id);
    expect(apres.consentement?.retireLe).toBeTruthy();
    expect(apres.consentement?.texte).toBe(inscription.consentement.texte);
  });
  it('deux tentatives d’envoi simultanées ne doublent pas le mail', async () => {
    const { deps } = fauxSite();
    await releverInscriptionsVma(t.app.db, { ...deps, ecriture: undefined });
    const test = (await contactsVma(t.app.db, instance.id))[0]!;
    await Promise.all([
      envoyerInvitation(t.app.db, instance, deps.ecriture, test),
      envoyerInvitation(t.app.db, instance, deps.ecriture, test),
    ]);
    expect(ecrits).toHaveLength(1);
  });
  it('le mail demandé et l’invitation directe gardent des introductions adaptées', () => {
    const p = {
      entrepriseNom: 'Entreprise fictive',
      contactNom: null,
      lien: 'https://site.test/test-vma?i=abc',
      expireLe: new Date(),
    };
    expect(mailInvitation({ ...p, origine: 'inscription' }).html).toContain(
      'Conformément à votre demande',
    );
    expect(mailInvitation(p).html).not.toContain('Conformément à votre demande');
  });
});

describe('Liens individuels de prospection VMA', () => {
  it('crée un accès distinct pour chaque mail et garde le lien du test séparé', async () => {
    let n = 0;
    const http = ((_url: unknown, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer jeton-fictif');
      expect(init?.method).toBe('POST');
      return Promise.resolve(
        Response.json({ id: (++n).toString().padStart(32, '0'), expireLe: '2099-01-01T00:00:00Z' }),
      );
    }) as typeof fetch;
    const deps = { url: 'https://site.test/', token: 'jeton-fictif', fetch: http };
    const a = await creerLienProspectionVma(deps);
    const b = await creerLienProspectionVma(deps);
    expect(a.lien).not.toBe(b.lien);
    expect(a.lien).toMatch(/^https:\/\/site.test\/inscription-vma\?a=[0-9a-f]{32}$/);
    expect(a.lien).not.toContain('/test-vma?i=');
  });
});
