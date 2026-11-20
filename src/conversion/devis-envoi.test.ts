import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { gmailConnector } from '../connecteurs/google/index.js';
import { configureConnexion, registerConnector } from '../connexions/service.js';
import { withInstance } from '../db/context.js';
import { seedDemoIfEmpty } from '../demo/seed.js';
import { getInstanceBySlug, setEcrituresReelles } from '../instances/service.js';
import type { Instance } from '../instances/schema.js';
import { deciderProposition } from '../pilotage/validations.js';
import {
  conclureDevis,
  creerDepuisAffaire,
  demanderTransmission,
  DevisRefuse,
  lireDevis,
  modifierContenu,
  validerDevis,
} from './devis.js';

describe('Devis : envoi (brouillon Gmail avec PDF, relance) et issue (accepté, refusé)', () => {
  let t: TestApp;
  let simatis: Instance;
  let secretsDir: string;
  const brouillons: string[] = [];
  const deps = (realWrites: boolean) => ({ secretsDir, realWrites });

  beforeAll(async () => {
    t = await setupTestApp();
    await seedDemoIfEmpty(t.owner.db);
    await setEcrituresReelles(t.owner.db, 'simatis', true);
    simatis = (await getInstanceBySlug(t.app.db, 'simatis'))!;
    secretsDir = await mkdtemp(path.join(tmpdir(), 'simatis-devis-envoi-'));
    await writeFile(
      path.join(secretsDir, 'simatis.env'),
      'GOOGLE_CLIENT_ID=c\nGOOGLE_CLIENT_SECRET=s\n',
    );
    await writeFile(
      path.join(secretsDir, 'simatis.google.json'),
      JSON.stringify({ refresh_token: 'rt' }),
    );
    registerConnector(
      gmailConnector({
        fetch: (url, init) => {
          if (url.endsWith('/drafts')) brouillons.push(init.body as string);
          return Promise.resolve(
            new Response(
              JSON.stringify(url.includes('oauth2') ? { access_token: 'at' } : { id: 'draft-1' }),
            ),
          );
        },
      }),
    );
    await withInstance(t.owner.db, simatis.id, (tx) =>
      configureConnexion(tx, { kind: 'messagerie', fournisseur: 'gmail', reglages: {} }),
    );
  });

  afterAll(async () => {
    await t.drop();
    await rm(secretsDir, { recursive: true, force: true });
  });

  // A validated quote on a fresh Pipeline affair; the contact has (or has not) an address.
  const devisValide = async (email: string | null) => {
    const { rows } = await t.owner.pool.query<{ id: string; contact_id: string | null }>(
      'select id, contact_id from opportunites where instance_id = $1 and clos is null and contact_id is not null and id not in (select opportunite_id from devis) order by titre limit 1',
      [simatis.id],
    );
    const affaire = rows[0]!;
    await t.owner.pool.query("update opportunites set etape = 'qualification' where id = $1", [
      affaire.id,
    ]);
    await t.owner.pool.query('update contacts set email = $1 where id = $2', [
      email,
      affaire.contact_id,
    ]);
    const { devis } = await creerDepuisAffaire(t.app.db, simatis, affaire.id);
    const d = await lireDevis(t.app.db, simatis, devis.id);
    await modifierContenu(t.app.db, simatis, devis.id, {
      titre: 'Mission fictive',
      contexte: d.contexte,
      objectifs: d.objectifs,
      inclus: 'Une prestation fictive',
      exclu: d.exclu,
      livrables: d.livrables,
      debut: d.debut,
      duree: d.duree,
      lignes: d.lignes.map((l) => ({ ...l, prixUnitaire: 1000 })),
      remisePct: d.remisePct,
      acomptePct: d.acomptePct,
      frais: d.frais,
      validiteJours: d.validiteJours,
      clauses: d.clauses,
    });
    await validerDevis(t.app.db, simatis, devis.id);
    return { id: devis.id, opportuniteId: affaire.id, contactId: affaire.contact_id! };
  };

  const transmettre = async (id: string, realWrites: boolean) => {
    const proposition = await demanderTransmission(
      t.app.db,
      { instance: simatis, ...deps(realWrites) },
      id,
    );
    return deciderProposition(
      t.app.db,
      simatis,
      proposition.id,
      { decision: 'valider' },
      deps(realWrites),
    );
  };

  const brouillonDecode = (corps: string) => {
    const { message } = JSON.parse(corps) as { message: { raw: string } };
    return Buffer.from(message.raw, 'base64url').toString('utf8');
  };

  it('crée un brouillon Gmail adressé au contact, avec le PDF du devis en pièce jointe', async () => {
    const v = await devisValide('contact.fictif@example.test');
    brouillons.length = 0;
    await transmettre(v.id, true);
    expect(brouillons).toHaveLength(1);
    const brut = brouillonDecode(brouillons[0]!);
    const numero = (await lireDevis(t.app.db, simatis, v.id)).numero;
    expect(brut).toContain('To: contact.fictif@example.test');
    expect(brut).toContain(`filename="devis-${numero}.pdf"`);
    const piece = brut.split('Content-Disposition: attachment')[1]!;
    const base64 = piece
      .split('\r\n')
      .filter((l) => /^[A-Za-z0-9+/=]{20,}$/.test(l))
      .join('');
    expect(Buffer.from(base64, 'base64').subarray(0, 4).toString()).toBe('%PDF');
    expect((await lireDevis(t.app.db, simatis, v.id)).statut).toBe('transmis');
  });

  it('programme une relance à J+10 sur l’affaire et le contact', async () => {
    const v = await devisValide('contact.fictif@example.test');
    await transmettre(v.id, true);
    const d = await lireDevis(t.app.db, simatis, v.id);
    const { rows } = await t.owner.pool.query<{
      titre: string;
      echeance: Date;
      contact_id: string;
    }>(
      "select titre, echeance, contact_id from taches where opportunite_id = $1 and titre like 'Relancer le devis%'",
      [v.opportuniteId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.titre).toContain(d.numero);
    expect(rows[0]!.contact_id).toBe(v.contactId);
    const jours = (rows[0]!.echeance.getTime() - new Date(d.envoyeLe!).getTime()) / 864e5;
    expect(Math.round(jours)).toBe(10);
  });

  it('sans adresse de contact : pas de brouillon, mais le devis est bien envoyé et la relance posée', async () => {
    const v = await devisValide(null);
    brouillons.length = 0;
    const resultat = await transmettre(v.id, true);
    expect(brouillons).toHaveLength(0);
    expect(JSON.stringify(resultat)).toMatch(/adresse/i);
    expect((await lireDevis(t.app.db, simatis, v.id)).statut).toBe('transmis');
    const { rows } = await t.owner.pool.query(
      "select 1 from taches where opportunite_id = $1 and titre like 'Relancer le devis%'",
      [v.opportuniteId],
    );
    expect(rows).toHaveLength(1);
  });

  it('écritures réelles coupées : rien n’est créé dans Gmail, le devis passe quand même à envoyé', async () => {
    const v = await devisValide('contact.fictif@example.test');
    brouillons.length = 0;
    await transmettre(v.id, false);
    expect(brouillons).toHaveLength(0);
    expect((await lireDevis(t.app.db, simatis, v.id)).statut).toBe('transmis');
  });

  it('un devis accepté gagne l’affaire', async () => {
    const v = await devisValide('contact.fictif@example.test');
    await transmettre(v.id, false);
    const conclu = await conclureDevis(t.app.db, simatis, v.id, { issue: 'accepte' }, deps(false));
    expect(conclu.statut).toBe('accepte');
    const { rows } = await t.owner.pool.query<{ clos: string }>(
      'select clos from opportunites where id = $1',
      [v.opportuniteId],
    );
    expect(rows[0]!.clos).toBe('gagne');
  });

  it('un devis refusé perd l’affaire avec son motif', async () => {
    const v = await devisValide('contact.fictif@example.test');
    await transmettre(v.id, false);
    const conclu = await conclureDevis(
      t.app.db,
      simatis,
      v.id,
      { issue: 'refuse', motif: 'Budget gelé' },
      deps(false),
    );
    expect(conclu.statut).toBe('refuse');
    const { rows } = await t.owner.pool.query<{ clos: string; motif: string }>(
      'select clos, motif from opportunites where id = $1',
      [v.opportuniteId],
    );
    expect(rows[0]).toMatchObject({ clos: 'perdu', motif: 'Budget gelé' });
  });

  it('refuse de conclure un devis qui n’est pas envoyé, ou déjà conclu', async () => {
    const v = await devisValide('contact.fictif@example.test');
    await expect(
      conclureDevis(t.app.db, simatis, v.id, { issue: 'accepte' }, deps(false)),
    ).rejects.toBeInstanceOf(DevisRefuse);
    await transmettre(v.id, false);
    await conclureDevis(t.app.db, simatis, v.id, { issue: 'accepte' }, deps(false));
    await expect(
      conclureDevis(t.app.db, simatis, v.id, { issue: 'refuse' }, deps(false)),
    ).rejects.toBeInstanceOf(DevisRefuse);
  });

  it('un devis conclu reste verrouillé', async () => {
    const v = await devisValide('contact.fictif@example.test');
    await transmettre(v.id, false);
    await conclureDevis(t.app.db, simatis, v.id, { issue: 'refuse' }, deps(false));
    const d = await lireDevis(t.app.db, simatis, v.id);
    await expect(
      modifierContenu(t.app.db, simatis, v.id, { ...d, titre: 'Autre' }),
    ).rejects.toBeInstanceOf(DevisRefuse);
  });
});
