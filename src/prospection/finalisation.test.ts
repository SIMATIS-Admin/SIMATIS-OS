import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { configureConnexion, registerConnector } from '../connexions/service.js';
import { contacts, entreprises, taches } from '../crm/schema.js';
import { withInstance } from '../db/context.js';
import { createInstance } from '../instances/service.js';
import type { Instance } from '../instances/schema.js';
import {
  CampagneInvalide,
  creerCampagneRelance,
  lireCampagne,
  reglageParDefaut,
} from './campagnes.js';
import { finaliserCampagne, modifierBrouillon, suiviDates } from './finalisation.js';
import { demarrerCampagne, deposerBrouillons } from './redaction.js';
import { prospectionOccurrences, type ReglageCampagne } from './schema.js';
import { ajouterSignature } from './signatures.js';

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(40, 3)]);
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

describe('suiviDates', () => {
  it('étale n échéances sur les jours ouvrés de la plage', () => {
    const d = suiviDates(6, [14, 28], '2026-11-02');
    expect(d).toHaveLength(6);
    expect(new Set(d).size).toBeGreaterThanOrEqual(4);
    for (const j of d) {
      const w = new Date(`${j}T12:00:00Z`).getUTCDay();
      expect(w).toBeGreaterThanOrEqual(1);
      expect(w).toBeLessThanOrEqual(5);
      expect(j >= '2026-11-16' && j <= '2026-11-30').toBe(true);
    }
    expect([...d].sort()).toEqual(d);
  });
});

describe('Relecture et finalisation d’une campagne', () => {
  let t: TestApp;
  let instance: Instance;
  let secretsDir: string;

  beforeAll(async () => {
    t = await setupTestApp();
    instance = await createInstance(t.owner.db, {
      slug: 'final-a',
      nom: 'A',
      type: 'mandat',
      config: { ecrituresReelles: true },
    });
    secretsDir = await mkdtemp(path.join(tmpdir(), 'simatis-final-'));
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
  const deps = (realWrites = true) => ({ secretsDir, realWrites });

  // Campagne en relecture : un brouillon prêt par nom, déposé comme Claude le ferait.
  async function enRelecture(noms: string[], reglage: ReglageCampagne = reglageParDefaut()) {
    const tacheIds: string[] = [];
    for (const nom of noms) {
      const [e] = await t.owner.db
        .insert(entreprises)
        .values({ instanceId: instance.id, nom: `Société ${nom}` })
        .returning({ id: entreprises.id });
      const [c] = await t.owner.db
        .insert(contacts)
        .values({
          instanceId: instance.id,
          nom,
          entrepriseId: e!.id,
          email: `${nom.toLowerCase()}@exemple.test`,
        })
        .returning({ id: contacts.id });
      const [tc] = await t.owner.db
        .insert(taches)
        .values({
          instanceId: instance.id,
          titre: `Relancer ${nom}`,
          canal: 'email',
          contactId: c!.id,
          echeance: new Date(),
        })
        .returning({ id: taches.id });
      tacheIds.push(tc!.id);
    }
    const { campagneId } = await dans(async (tx) => {
      const r = await creerCampagneRelance(tx, { tacheIds, reglage });
      await demarrerCampagne(tx, r.campagneId);
      return r;
    });
    const c = await dans((tx) => lireCampagne(tx, campagneId));
    await dans((tx) =>
      deposerBrouillons(
        tx,
        campagneId,
        c.brouillons.map((b) => ({
          id: b.id,
          objet: `Re: ${b.contactNom}`,
          corps: `<p>Bonjour ${b.contactNom},</p><p>Bien à vous,</p>`,
          threadId: `fil-${b.contactNom}`,
        })),
      ),
    );
    return {
      campagneId,
      tacheIds,
      brouillons: (await dans((tx) => lireCampagne(tx, campagneId))).brouillons,
    };
  }

  it('modifie le texte (nettoyé), écarte, et règle le suivi', async () => {
    const { brouillons } = await enRelecture(['Alice']);
    const b = brouillons[0]!;
    const m = await dans((tx) =>
      modifierBrouillon(tx, b.id, {
        corps: '<p>Salut</p><script>x</script>',
        objet: 'Nouvel objet',
      }),
    );
    expect(m.corps).not.toContain('script');
    expect(m.objet).toBe('Nouvel objet');
    expect((await dans((tx) => modifierBrouillon(tx, b.id, { etat: 'ecarte' }))).etat).toBe(
      'ecarte',
    );
    expect(
      (await dans((tx) => modifierBrouillon(tx, b.id, { etat: 'pret', suiviType: 'clos' })))
        .suiviType,
    ).toBe('clos');
    await expect(
      dans((tx) => modifierBrouillon(tx, b.id, { suiviType: 'citee' })),
    ).rejects.toBeInstanceOf(CampagneInvalide);
    await expect(
      dans((tx) => modifierBrouillon(tx, b.id, { suiviType: 'citee', suiviDate: '2020-01-01' })),
    ).rejects.toBeInstanceOf(CampagneInvalide);
    const citee = await dans((tx) =>
      modifierBrouillon(tx, b.id, { suiviType: 'citee', suiviDate: '2099-01-15' }),
    );
    expect(citee.suiviType).toBe('citee');
  });

  it('en simulation : aucune occurrence ni tâche, la campagne reste en relecture', async () => {
    ecrits.length = 0;
    const { campagneId } = await enRelecture(['Bruno', 'Carole']);
    const avant = (await t.owner.db.select().from(taches).where(eq(taches.instanceId, instance.id)))
      .length;
    const r = await finaliserCampagne(t.app.db, instance, campagneId, deps(false));
    expect(r.simulation).toBe(true);
    expect(ecrits).toHaveLength(0);
    expect(
      (await t.owner.db.select().from(taches).where(eq(taches.instanceId, instance.id))).length,
    ).toBe(avant);
    const c = await dans((tx) => lireCampagne(tx, campagneId));
    expect(c.statut).toBe('relecture');
    expect(c.brouillons.every((b) => b.etat === 'pret')).toBe(true);
  });

  it('réel : brouillons créés avec signature et fil, occurrences, suivis, tâches faites', async () => {
    ecrits.length = 0;
    const sig = await dans((tx) =>
      ajouterSignature(tx, {
        nom: 'Signature réelle',
        typeMime: 'image/png',
        imageBase64: png.toString('base64'),
      }),
    );
    const { campagneId, tacheIds, brouillons } = await enRelecture(
      ['Denis', 'Emma', 'Farid', 'Gaëlle'],
      {
        ...reglageParDefaut(),
        signatureId: sig.id,
      },
    );
    const [denis, emma, farid, gaelle] = brouillons;
    await dans(async (tx) => {
      await modifierBrouillon(tx, emma!.id, { suiviType: 'citee', suiviDate: '2099-01-15' });
      await modifierBrouillon(tx, farid!.id, { suiviType: 'clos' });
      await modifierBrouillon(tx, gaelle!.id, { etat: 'ecarte' });
    });
    const r = await finaliserCampagne(t.app.db, instance, campagneId, deps());
    expect(r).toEqual({
      brouillons: 3,
      simulation: false,
      suivisCrees: 2,
      suivisNonCrees: 0,
      clos: 1,
      faites: 3,
      echecs: 0,
    });

    expect(ecrits).toHaveLength(3);
    const un = ecrits.find((e) => e.data.to === 'denis@exemple.test')!;
    expect(un.op).toBe('draft.create');
    expect(un.data).toMatchObject({ subject: 'Re: Denis', threadId: 'fil-Denis' });
    expect(String(un.data.html)).toContain('cid:signature');
    expect((un.data.images as { base64: string }[])[0]?.base64).toBe(png.toString('base64'));

    const c = await dans((tx) => lireCampagne(tx, campagneId));
    expect(c.statut).toBe('terminee');
    expect(c.brouillons.map((b) => b.etat).sort()).toEqual(['cree', 'cree', 'cree', 'ecarte']);
    expect(c.resultat).toEqual(r);

    const occ = await t.owner.db
      .select()
      .from(prospectionOccurrences)
      .where(eq(prospectionOccurrences.lot, campagneId));
    expect(occ).toHaveLength(3);
    expect(occ.every((o) => o.etat === 'brouillon' && o.mode === 'relance' && o.touche === 2)).toBe(
      true,
    );
    expect(occ.find((o) => o.contactNom === 'Denis')?.threadId).toBe('fil-Denis');

    const suivis = await t.owner.db
      .select()
      .from(taches)
      .where(and(eq(taches.instanceId, instance.id), eq(taches.canal, 'email')));
    const titres = suivis.map((s) => s.titre);
    expect(titres).toContain('RELANCE de prospection (MAIL) : Denis');
    expect(titres).toContain('RELANCE de prospection (MAIL) : Emma');
    expect(titres).not.toContain('RELANCE de prospection (MAIL) : Farid');
    const emmaSuivi = suivis.find((s) => s.titre === 'RELANCE de prospection (MAIL) : Emma')!;
    expect(emmaSuivi.echeance?.toISOString().slice(0, 10)).toBe('2099-01-15');
    expect(denis).toBeDefined();

    const faites = await t.owner.db
      .select({ id: taches.id, faitAt: taches.faitAt })
      .from(taches)
      .where(eq(taches.instanceId, instance.id));
    const fait = (id: string) => faites.find((f) => f.id === id)?.faitAt;
    expect(fait(tacheIds[0]!)).not.toBeNull();
    expect(fait(tacheIds[3]!)).toBeNull();
  });

  it('refuse de finaliser deux fois la même campagne', async () => {
    const { campagneId } = await enRelecture(['Hugo']);
    await finaliserCampagne(t.app.db, instance, campagneId, deps());
    await expect(finaliserCampagne(t.app.db, instance, campagneId, deps())).rejects.toBeInstanceOf(
      CampagneInvalide,
    );
  });

  it('refuse tant qu’un brouillon est « à vérifier » ou qu’aucun n’est prêt', async () => {
    const { campagneId, brouillons } = await enRelecture(['Inès', 'Jules']);
    await t.owner.db
      .update((await import('./schema.js')).prospectionBrouillons)
      .set({ etat: 'a_verifier', note: 'Fil introuvable' })
      .where(eq((await import('./schema.js')).prospectionBrouillons.id, brouillons[0]!.id));
    await expect(finaliserCampagne(t.app.db, instance, campagneId, deps())).rejects.toThrow(
      /à vérifier/,
    );
    await dans((tx) => modifierBrouillon(tx, brouillons[0]!.id, { etat: 'ecarte' }));
    await dans((tx) => modifierBrouillon(tx, brouillons[1]!.id, { etat: 'ecarte' }));
    await expect(finaliserCampagne(t.app.db, instance, campagneId, deps())).rejects.toThrow(
      /aucun brouillon/i,
    );
  });

  it('refuse de finaliser sans messagerie branchée', async () => {
    const sans = await createInstance(t.owner.db, {
      slug: 'final-sans',
      nom: 'Sans',
      type: 'mandat',
    });
    const [c] = await t.owner.db
      .insert(contacts)
      .values({ instanceId: sans.id, nom: 'Léa', email: 'lea@exemple.test' })
      .returning({ id: contacts.id });
    const [tc] = await t.owner.db
      .insert(taches)
      .values({ instanceId: sans.id, titre: 'Relancer Léa', canal: 'email', contactId: c!.id })
      .returning({ id: taches.id });
    const campagneId = await withInstance(t.app.db, sans.id, async (tx) => {
      const r = await creerCampagneRelance(tx, { tacheIds: [tc!.id], reglage: reglageParDefaut() });
      await demarrerCampagne(tx, r.campagneId);
      const [b] = (await lireCampagne(tx, r.campagneId)).brouillons;
      await deposerBrouillons(tx, r.campagneId, [{ id: b!.id, objet: 'x', corps: '<p>x</p>' }]);
      return r.campagneId;
    });
    await expect(finaliserCampagne(t.app.db, sans, campagneId, deps())).rejects.toThrow(
      /Aucune messagerie/,
    );
  });

  it('HubSpot en lecture seule : le suivi est créé dans l’OS et compté comme non créé dans HubSpot', async () => {
    await dans((tx) =>
      configureConnexion(tx, {
        kind: 'crm',
        fournisseur: 'hubspot',
        reglages: { sens: 'lecture', objets: ['taches'] },
      }),
    );
    const { campagneId } = await enRelecture(['Karim']);
    const r = await finaliserCampagne(t.app.db, instance, campagneId, deps());
    expect(r.suivisCrees).toBe(0);
    expect(r.suivisNonCrees).toBe(1);
    const os = await t.owner.db
      .select()
      .from(taches)
      .where(
        and(
          eq(taches.instanceId, instance.id),
          eq(taches.titre, 'RELANCE de prospection (MAIL) : Karim'),
        ),
      );
    expect(os).toHaveLength(1);
    expect(os[0]?.source).toBe('natif');
  });
});
