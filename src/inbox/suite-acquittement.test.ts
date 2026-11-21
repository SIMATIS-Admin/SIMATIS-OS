import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { fabrique } from '../../test/transfert.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { enregistrerDepuisSujet } from './compte-rendu.js';
import { deposerSujet } from './depot.js';
import { SujetRefuse } from './service.js';

const deps = { secretsDir: '/nonexistent', realWrites: false };

describe('Inbox : la suite appliquée à l’acquittement', () => {
  let t: TestApp;
  let siege: Instance;
  let mandat: Instance;
  let n = 0;

  beforeAll(async () => {
    t = await setupTestApp();
    siege = await createInstance(t.owner.db, { slug: 'sa-siege', nom: 'Siège', type: 'propre' });
    mandat = await createInstance(t.owner.db, { slug: 'sa-mandat', nom: 'M', type: 'mandat' });
  });
  afterAll(async () => {
    await t.drop();
  });

  const sql = <T extends object>(texte: string, valeurs: unknown[] = []) =>
    t.owner.pool.query<T>(texte, valeurs);
  const monde = async (i: Instance) => {
    const f = fabrique(t);
    const entreprise = await f.entreprise(i, `Entreprise Fictive ${++n}`);
    const contact = await f.insere(i, 'contacts', 'nom, source, entreprise_id', [
      `Camille Fictive ${n}`,
      'natif',
      entreprise,
    ]);
    const cle = `sa-${n}`;
    const { id } = await withInstance(t.app.db, i.id, (tx) =>
      deposerSujet(tx, {
        type: 'compte_rendu',
        titre: `Résumé de la visio : ${cle}`,
        origine: 'os',
        source: 'visio',
        sourceId: cle,
        contactId: contact,
      }),
    );
    await sql('update sujets set compte_rendu_prepare = $1 where id = $2', [
      JSON.stringify({
        texte: 'Texte fictif.',
        prepareeLe: '2026-11-20T10:00:00Z',
        dossier: {
          sessionVisioId: '00000000-0000-4000-8000-000000000001',
          sourceRdvEventId: `os:${cle}`,
          rdv: null,
          rdvCertain: false,
          candidats: [],
          interlocuteurs: [],
        },
      }),
      id,
    ]);
    return { id, entreprise, contact };
  };
  const acquitter = (
    i: Instance,
    id: string,
    contactId: string,
    suite?: Parameters<typeof enregistrerDepuisSujet>[3]['suite'],
  ) =>
    enregistrerDepuisSujet(
      t.app.db,
      i,
      id,
      { texte: 'Compte rendu fictif.', contactId, ...(suite ? { suite } : {}) },
      deps,
    );
  const diagnostics = (i: Instance) =>
    sql<{ nom: string; entreprise_id: string | null; contact_id: string | null }>(
      'select nom, entreprise_id, contact_id from diagnostic_projets where instance_id = $1 order by created_at',
      [i.id],
    ).then((r) => r.rows);

  it('crée le diagnostic coché, rattaché à l’entreprise et au contact, sous le nom corrigé', async () => {
    const { id, entreprise, contact } = await monde(siege);
    await acquitter(siege, id, contact, { diagnostic: { nom: 'Diagnostic – Nom corrigé' } });
    expect(await diagnostics(siege)).toEqual([
      { nom: 'Diagnostic – Nom corrigé', entreprise_id: entreprise, contact_id: contact },
    ]);
  });

  it('sans ligne cochée, rien n’est créé', async () => {
    const { id, contact } = await monde(siege);
    const avant = (await diagnostics(siege)).length;
    await acquitter(siege, id, contact);
    expect((await diagnostics(siege)).length).toBe(avant);
  });

  it('crée le rendez-vous coché dans l’OS, relié au contact et à l’entreprise', async () => {
    const { id, contact, entreprise } = await monde(siege);
    await acquitter(siege, id, contact, {
      rdv: { titre: 'Diagnostic fictif', debut: '2031-05-06T08:00:00.000Z' },
    });
    const r = await sql<{ event_id: string; debut: Date; liens: number }>(
      `select r.event_id, r.debut,
         (select count(*)::int from rdv_contacts c where c.rendez_vous_id = r.id and c.contact_id = $2)
         + (select count(*)::int from rdv_entreprises e where e.rendez_vous_id = r.id and e.entreprise_id = $3) as liens
       from rendez_vous r where r.instance_id = $1 and r.titre = 'Diagnostic fictif'`,
      [siege.id, contact, entreprise],
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.event_id.startsWith('os:')).toBe(true);
    expect(r.rows[0]?.debut.toISOString()).toBe('2031-05-06T08:00:00.000Z');
    expect(r.rows[0]?.liens).toBe(2);
  });

  it('crée la tâche de relance cochée avec son échéance, liée au contact et à l’entreprise', async () => {
    const { id, contact, entreprise } = await monde(siege);
    await acquitter(siege, id, contact, {
      relance: { titre: 'Relancer Camille fictive', echeance: '2031-05-20' },
    });
    const r = await sql<{ echeance: Date; contact_id: string; entreprise_id: string }>(
      "select echeance, contact_id, entreprise_id from taches where instance_id = $1 and titre = 'Relancer Camille fictive'",
      [siege.id],
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.echeance.toISOString().slice(0, 10)).toBe('2031-05-20');
    expect(r.rows[0]).toMatchObject({ contact_id: contact, entreprise_id: entreprise });
  });

  it('rejouer un acquittement interrompu ne duplique ni diagnostic, ni rendez-vous, ni tâche', async () => {
    const { id, contact } = await monde(siege);
    const suite = {
      diagnostic: { nom: 'Diagnostic – Rejeu' },
      rdv: { titre: 'Rendez-vous rejeu', debut: '2031-06-06T08:00:00.000Z' },
      relance: { titre: 'Relance rejeu', echeance: '2031-06-20' },
    };
    await acquitter(siege, id, contact, suite);
    // Simule l'échec après les créations : l'entrée redevient à traiter, Marc acquitte de nouveau.
    await sql("update sujets set statut = 'a_traiter' where id = $1", [id]);
    await acquitter(siege, id, contact, suite);
    const compte = async (table: string, titre: string, col = 'titre') =>
      (
        await sql<{ n: number }>(
          `select count(*)::int as n from ${table} where instance_id = $1 and ${col} = $2`,
          [siege.id, titre],
        )
      ).rows[0]?.n;
    expect(await compte('diagnostic_projets', 'Diagnostic – Rejeu', 'nom')).toBe(1);
    expect(await compte('rendez_vous', 'Rendez-vous rejeu')).toBe(1);
    expect(await compte('taches', 'Relance rejeu')).toBe(1);
  });

  it('refuse un diagnostic hors de l’espace SIMATIS, sans avoir rien créé ni traité', async () => {
    const { id, contact } = await monde(mandat);
    await expect(
      acquitter(mandat, id, contact, {
        diagnostic: { nom: 'Diagnostic – Hors espace' },
        relance: { titre: 'Relance refusée', echeance: '2031-06-20' },
      }),
    ).rejects.toBeInstanceOf(SujetRefuse);
    const r = await sql<{ statut: string }>('select statut from sujets where id = $1', [id]);
    expect(r.rows[0]?.statut).toBe('a_traiter');
    const taches = await sql(
      "select 1 from taches where instance_id = $1 and titre = 'Relance refusée'",
      [mandat.id],
    );
    expect(taches.rows).toHaveLength(0);
  });
});
