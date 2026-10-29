import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { getFiche } from '../crm/fiches.js';
import { contacts } from '../crm/schema.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { candidatsRendezVous, enregistrerDepuisSujet } from './compte-rendu.js';
import { deposerSujet } from './depot.js';
import { deposerReunion } from './reunions.js';
import { SujetRefuse } from './service.js';

const deps = { secretsDir: '/nonexistent', realWrites: false };

describe('Inbox : compte rendu écrit dans le rendez-vous', () => {
  let t: TestApp;
  let a: Instance;
  let contactId: string;

  beforeAll(async () => {
    t = await setupTestApp();
    a = await createInstance(t.owner.db, { slug: 'cr-a', nom: 'A', type: 'mandat' });
    [{ id: contactId }] = await withInstance(t.app.db, a.id, (tx) =>
      tx
        .insert(contacts)
        .values({ instanceId: a.id, nom: 'Dupont Fictif' })
        .returning({ id: contacts.id }),
    ).then((r) => r as [{ id: string }]);
  });
  afterAll(async () => {
    await t.drop();
  });

  const evenement = (eventId: string, debut: string, statut = 'a_trier') =>
    t.owner.pool.query(
      `insert into rendez_vous (instance_id, event_id, titre, debut, statut) values ($1, $2, $3, $4, $5)`,
      [a.id, eventId, `Visio ${eventId}`, debut, statut],
    );
  const reunion = (wisprId: string, debutAt: string) =>
    withInstance(t.app.db, a.id, (tx) =>
      deposerReunion(tx, {
        wisprId,
        titre: 'Visio fictive',
        debutAt: new Date(debutAt),
        participants: [],
        resume: null,
        contactId,
      }),
    );
  const rdvs = async () =>
    (
      await t.owner.pool.query<{ event_id: string; statut: string; compte_rendu: string | null }>(
        'select event_id, statut, compte_rendu from rendez_vous where instance_id = $1 order by event_id',
        [a.id],
      )
    ).rows;

  it('propose l’événement Google proche de la réunion, pas les écartés ni les lointains', async () => {
    await evenement('g-proche', '2026-10-28T09:30:00Z');
    await evenement('g-ecarte', '2026-10-28T09:00:00Z', 'ignore');
    await evenement('g-loin', '2026-09-01T09:00:00Z');
    const { sujetId } = await reunion('w-1', '2026-10-28T09:00:00Z');
    const c = await candidatsRendezVous(t.app.db, a, sujetId);
    expect(c?.map((x) => x.eventId)).toEqual(['g-proche']);
    expect(c?.[0]?.propose).toBe(true);
  });

  it('écrit le compte rendu sur l’événement, relie le contact, traite l’entrée, sans doublon', async () => {
    const { sujetId } = await reunion('w-2', '2026-10-28T14:00:00Z');
    await evenement('g-2', '2026-10-28T14:00:00Z');
    const vue = await enregistrerDepuisSujet(
      t.app.db,
      a,
      sujetId,
      { eventId: 'g-2', texte: 'Décisions fictives.' },
      deps,
    );
    expect(vue?.statut).toBe('traite');
    expect((await rdvs()).find((r) => r.event_id === 'g-2')).toMatchObject({
      statut: 'rdv',
      compte_rendu: 'Décisions fictives.',
    });
    const lien = await t.owner.pool.query(
      `select 1 from rdv_contacts rc join rendez_vous r on r.id = rc.rendez_vous_id
       where r.event_id = 'g-2' and rc.contact_id = $1`,
      [contactId],
    );
    expect(lien.rowCount).toBe(1);
    const histo = await t.owner.pool.query<{ n: number }>(
      `select count(*)::int as n from activites where instance_id = $1 and source_id = 'g-2'`,
      [a.id],
    );
    expect(histo.rows[0]?.n).toBe(1);
    // Déjà traitée : on ne recommence pas.
    await expect(
      enregistrerDepuisSujet(t.app.db, a, sujetId, { eventId: 'g-2', texte: 'Bis' }, deps),
    ).rejects.toBeInstanceOf(SujetRefuse);
  });

  it('crée un rendez-vous dans l’OS (os:) quand aucun événement ne correspond', async () => {
    const { sujetId } = await reunion('w-3', '2026-10-29T08:00:00Z');
    await enregistrerDepuisSujet(
      t.app.db,
      a,
      sujetId,
      { texte: 'Point téléphonique fictif.' },
      deps,
    );
    const os = (await rdvs()).filter((r) => r.event_id.startsWith('os:'));
    expect(os).toHaveLength(1);
    expect(os[0]).toMatchObject({ statut: 'rdv', compte_rendu: 'Point téléphonique fictif.' });
    // Dans la fiche du contact : une seule ligne pour ce rendez-vous, le compte rendu.
    const fiche = await getFiche(t.app.db, a, 'contact', contactId);
    const lignes = (fiche?.historique ?? []).filter((e) =>
      ['reunion', 'compte_rendu'].includes(e.type),
    );
    expect(lignes.filter((e) => e.texte === 'Point téléphonique fictif.')).toHaveLength(1);
    expect(lignes.some((e) => e.id.startsWith('rdv-'))).toBe(false);
  });

  it('refuse une entrée qui n’est pas un compte rendu, et une entrée inconnue', async () => {
    const autre = await withInstance(t.app.db, a.id, (tx) =>
      deposerSujet(tx, {
        type: 'devis',
        titre: 'Devis fictif',
        origine: 'os',
        source: 'test',
        sourceId: 'devis-1',
      }),
    );
    await expect(
      enregistrerDepuisSujet(t.app.db, a, autre.id, { texte: 'x' }, deps),
    ).rejects.toBeInstanceOf(SujetRefuse);
    expect(
      await enregistrerDepuisSujet(
        t.app.db,
        a,
        '00000000-0000-4000-8000-000000000000',
        { texte: 'x' },
        deps,
      ),
    ).toBeNull();
  });

  it('refuse un identifiant os: inventé', async () => {
    const { sujetId } = await reunion('w-4', '2026-10-29T10:00:00Z');
    await expect(
      enregistrerDepuisSujet(t.app.db, a, sujetId, { eventId: 'os:inventé', texte: 'x' }, deps),
    ).rejects.toBeInstanceOf(SujetRefuse);
  });
});
