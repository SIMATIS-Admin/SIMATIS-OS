import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { getFiche } from '../crm/fiches.js';
import { contacts } from '../crm/schema.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { enregistrerCompteRendu } from '../conversion/rdv.js';
import { candidatsRendezVous, enregistrerDepuisSujet } from './compte-rendu.js';
import type { DossierRdv } from './schema.js';
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

describe('Inbox : acquittement d’un rendez-vous avec dossier', () => {
  let t: TestApp;
  let a: Instance;
  let camille: string;
  let robin: string;
  let n = 0;

  beforeAll(async () => {
    t = await setupTestApp();
    a = await createInstance(t.owner.db, { slug: 'acq-a', nom: 'A', type: 'mandat' });
    const entreprise = (
      await t.owner.pool.query<{ id: string }>(
        "insert into entreprises (instance_id, nom) values ($1, 'Entreprise Fictive') returning id",
        [a.id],
      )
    ).rows[0]!.id;
    camille = (
      await t.owner.pool.query<{ id: string }>(
        "insert into contacts (instance_id, nom, entreprise_id) values ($1, 'Camille Fictive', $2) returning id",
        [a.id, entreprise],
      )
    ).rows[0]!.id;
    robin = (
      await t.owner.pool.query<{ id: string }>(
        "insert into contacts (instance_id, nom) values ($1, 'Robin Fictif') returning id",
        [a.id],
      )
    ).rows[0]!.id;
  });
  afterAll(async () => {
    await t.drop();
  });

  const sql = <T extends object>(texte: string, valeurs: unknown[] = []) =>
    t.owner.pool.query<T>(texte, valeurs);
  const rdvAgenda = async (eventId: string) =>
    (
      await sql<{ id: string }>(
        "insert into rendez_vous (instance_id, event_id, titre, debut, statut) values ($1, $2, $3, now(), 'rdv') returning id",
        [a.id, eventId, `Visio ${eventId}`],
      )
    ).rows[0]!.id;
  // Entrée « compte rendu » d'une visio, avec son dossier.
  const entree = async (dossier: Partial<DossierRdv> = {}, contactId: string | null = null) => {
    const cle = `acq-${++n}`;
    const { id } = await withInstance(t.app.db, a.id, (tx) =>
      deposerSujet(tx, {
        type: 'compte_rendu',
        titre: `Résumé de la visio : ${cle}`,
        origine: 'os',
        source: 'visio',
        sourceId: cle,
        contactId,
      }),
    );
    const complet: DossierRdv = {
      sessionVisioId: '00000000-0000-4000-8000-000000000001',
      sourceRdvEventId: `os:${cle}`,
      rdv: null,
      rdvCertain: false,
      candidats: [],
      interlocuteurs: [],
      ...dossier,
    };
    await sql('update sujets set compte_rendu_prepare = $1 where id = $2', [
      JSON.stringify({
        texte: 'Texte fictif.',
        prepareeLe: '2026-11-20T10:00:00Z',
        dossier: complet,
      }),
      id,
    ]);
    return { id, cle };
  };
  const acquitter = (id: string, corps: Parameters<typeof enregistrerDepuisSujet>[3]) =>
    enregistrerDepuisSujet(t.app.db, a, id, corps, deps);
  const compterNotes = async (titre: string) =>
    (
      await sql<{ statut: string }>(
        "select statut from propositions where instance_id = $1 and type = 'note.second_cerveau' and contenu->>'titre' like $2",
        [a.id, `%${titre}%`],
      )
    ).rows;

  it('enregistre le compte rendu sur le rendez-vous retenu et lie l’interlocuteur choisi', async () => {
    await rdvAgenda('ev-acq-1');
    const { id } = await entree();
    const vue = await acquitter(id, {
      eventId: 'ev-acq-1',
      texte: 'Compte rendu fictif.',
      contactId: camille,
    });
    expect(vue?.statut).toBe('traite');
    const r = await sql<{ compte_rendu: string; n: number }>(
      `select r.compte_rendu, (select count(*)::int from rdv_contacts rc where rc.rendez_vous_id = r.id and rc.contact_id = $2) as n
       from rendez_vous r where r.instance_id = $1 and r.event_id = 'ev-acq-1'`,
      [a.id, camille],
    );
    expect(r.rows[0]).toEqual({ compte_rendu: 'Compte rendu fictif.', n: 1 });
  });

  it('cerveau coché : la note est appliquée sur l’accord de l’acquittement, sans entrée de plus', async () => {
    await rdvAgenda('ev-acq-2');
    const { id, cle } = await entree();
    await acquitter(id, { eventId: 'ev-acq-2', texte: 'Texte note.', cerveau: true });
    expect((await compterNotes(cle)).map((x) => x.statut)).toEqual(['appliquee']);
    const ouvertes = await sql(
      `select 1 from sujets s join propositions p on p.id = s.proposition_id
       where s.instance_id = $1 and s.statut = 'a_traiter' and p.contenu->>'titre' like $2`,
      [a.id, `%${cle}%`],
    );
    expect(ouvertes.rowCount).toBe(0);
  });

  it('cerveau décoché : aucune note, et jamais de tâche « Prochaine étape »', async () => {
    await rdvAgenda('ev-acq-3');
    const { id, cle } = await entree();
    await acquitter(id, { eventId: 'ev-acq-3', texte: 'Sans note.', cerveau: false });
    expect(await compterNotes(cle)).toEqual([]);
    const taches = await sql(
      "select 1 from propositions where instance_id = $1 and type = 'crm.tache'",
      [a.id],
    );
    expect(taches.rowCount).toBe(0);
  });

  it('sans rendez-vous choisi ni contact, l’acquittement crée le rendez-vous et ne lie personne', async () => {
    const { id, cle } = await entree();
    const vue = await acquitter(id, { texte: 'Rien à lier.', titre: `Rendez-vous ${cle}` });
    expect(vue?.statut).toBe('traite');
    const liens = await sql(
      `select 1 from rdv_contacts rc join rendez_vous r on r.id = rc.rendez_vous_id
       where r.instance_id = $1 and r.titre = $2`,
      [a.id, `Rendez-vous ${cle}`],
    );
    expect(liens.rowCount).toBe(0);
  });

  it('un double clic ne crée qu’un rendez-vous, un compte rendu et une note', async () => {
    const { id, cle } = await entree();
    const corps = { texte: 'Double clic.', titre: `Double ${cle}`, cerveau: true };
    const rs = await Promise.allSettled([acquitter(id, corps), acquitter(id, corps)]);
    expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refus = rs.find((r) => r.status === 'rejected');
    expect(refus?.status === 'rejected' && refus.reason).toBeInstanceOf(SujetRefuse);
    const rdv = await sql('select 1 from rendez_vous where instance_id = $1 and titre = $2', [
      a.id,
      `Double ${cle}`,
    ]);
    expect(rdv.rowCount).toBe(1);
    expect(await compterNotes(cle)).toHaveLength(1);
  });

  it('fusionne la visio libre dans le rendez-vous retenu de l’agenda', async () => {
    await rdvAgenda('ev-acq-5');
    const libre = (
      await sql<{ id: string }>(
        "insert into rendez_vous (instance_id, event_id, titre, debut, statut, source) values ($1, 'os:lib-5', 'Enregistrement fictif', now(), 'rdv', 'visio-libre') returning id",
        [a.id],
      )
    ).rows[0]!.id;
    const session = (
      await sql<{ id: string }>(
        "insert into enregistrements_visio (instance_id, rendez_vous_id, statut, transcript) values ($1, $2, 'transcrit', 'Moi : Texte de la visio fictive.') returning id",
        [a.id, libre],
      )
    ).rows[0]!.id;
    const { id } = await entree({
      sessionVisioId: session,
      sourceRdvEventId: 'os:lib-5',
      rdv: { eventId: 'ev-acq-5', titre: 'Visio ev-acq-5', debut: null },
      rdvCertain: true,
    });
    await acquitter(id, { eventId: 'ev-acq-5', texte: 'Après fusion.' });
    const r = await sql<{ transcript: string }>(
      "select transcript from rendez_vous where instance_id = $1 and event_id = 'ev-acq-5'",
      [a.id],
    );
    expect(r.rows[0]?.transcript).toContain('Texte de la visio fictive.');
  });

  const liensContact = async (eventId: string) =>
    (
      await sql<{ contact_id: string }>(
        `select rc.contact_id from rdv_contacts rc join rendez_vous r on r.id = rc.rendez_vous_id
         where r.instance_id = $1 and r.event_id = $2`,
        [a.id, eventId],
      )
    ).rows.map((x) => x.contact_id);

  it('le contact choisi remplace celui de l’OS : seul lui est lié et reçoit l’historique', async () => {
    await rdvAgenda('ev-acq-8');
    const { id } = await entree({}, camille);
    await acquitter(id, { eventId: 'ev-acq-8', texte: 'Pour Robin.', contactId: robin });
    expect(await liensContact('ev-acq-8')).toEqual([robin]);
    const histo = await sql<{ contact_id: string }>(
      "select contact_id from activites where instance_id = $1 and source_id = 'ev-acq-8'",
      [a.id],
    );
    expect(histo.rows[0]?.contact_id).toBe(robin);
  });

  it('aucun interlocuteur choisi : personne n’est lié, même si l’OS en avait reconnu un', async () => {
    await rdvAgenda('ev-acq-9');
    const { id } = await entree({}, camille);
    await acquitter(id, { eventId: 'ev-acq-9', texte: 'Pour personne.', contactId: null });
    expect(await liensContact('ev-acq-9')).toEqual([]);
  });

  it('un contact introuvable est refusé avant toute création de rendez-vous', async () => {
    const { id, cle } = await entree();
    await expect(
      acquitter(id, {
        texte: 'x',
        titre: `Orphelin ${cle}`,
        contactId: '00000000-0000-4000-8000-0000000000aa',
      }),
    ).rejects.toBeInstanceOf(SujetRefuse);
    const rdv = await sql('select 1 from rendez_vous where instance_id = $1 and titre = $2', [
      a.id,
      `Orphelin ${cle}`,
    ]);
    expect(rdv.rowCount).toBe(0);
  });

  it('l’entrée de l’agenda du rendez-vous retenu est traitée en même temps : une réunion, une entrée', async () => {
    await rdvAgenda('ev-acq-10');
    const agenda = await withInstance(t.app.db, a.id, (tx) =>
      deposerSujet(tx, {
        type: 'compte_rendu',
        titre: 'Rédiger le compte rendu de ev-acq-10',
        origine: 'agenda',
        source: 'routine',
        sourceId: 'agenda:ev-acq-10',
      }),
    );
    const { id } = await entree();
    await acquitter(id, { eventId: 'ev-acq-10', texte: 'Une seule entrée.' });
    const r = await sql<{ statut: string }>('select statut from sujets where id = $1', [agenda.id]);
    expect(r.rows[0]?.statut).toBe('traite');
  });

  describe('enregistrerCompteRendu depuis la fiche, avec une entrée ouverte', () => {
    it('met le texte écrit par Marc dans l’entrée, pour que l’acquittement ne l’écrase pas', async () => {
      await rdvAgenda('ev-acq-11');
      const { id } = await entree({
        rdv: { eventId: 'ev-acq-11', titre: 'x', debut: null },
        rdvCertain: true,
      });
      await enregistrerCompteRendu(
        t.app.db,
        a,
        'ev-acq-11',
        {
          titre: 'Fiche fictive',
          texte: 'Écrit depuis la fiche.',
          proposerTache: true,
          versCerveau: true,
        },
        deps,
      );
      const r = await sql<{ texte: string; dossier: unknown }>(
        "select compte_rendu_prepare->>'texte' as texte, compte_rendu_prepare->'dossier' as dossier from sujets where id = $1",
        [id],
      );
      expect(r.rows[0]?.texte).toBe('Écrit depuis la fiche.');
      expect(r.rows[0]?.dossier).not.toBeNull();
    });
  });

  describe('enregistrerCompteRendu depuis la fiche du rendez-vous', () => {
    const enregistrer = (eventId: string, titre: string) =>
      enregistrerCompteRendu(
        t.app.db,
        a,
        eventId,
        { titre, texte: 'Texte fiche.', proposerTache: true, versCerveau: true },
        deps,
      );
    const propositionsDe = async (titre: string) =>
      (
        await sql<{ type: string }>(
          "select type from propositions where instance_id = $1 and (contenu->>'titre' like $2)",
          [a.id, `%${titre}%`],
        )
      ).rows.map((x) => x.type);

    it('ne crée ni note ni tâche quand une entrée avec dossier est ouverte pour ce rendez-vous', async () => {
      await rdvAgenda('ev-acq-6');
      await entree({ rdv: { eventId: 'ev-acq-6', titre: 'x', debut: null }, rdvCertain: true });
      await enregistrer('ev-acq-6', 'Garde-fou fictif');
      expect(await propositionsDe('Garde-fou fictif')).toEqual([]);
    });

    it('sans entrée ouverte, propose toujours la note et la tâche', async () => {
      await rdvAgenda('ev-acq-7');
      await enregistrer('ev-acq-7', 'Sans entrée fictive');
      expect((await propositionsDe('Sans entrée fictive')).sort()).toEqual([
        'crm.tache',
        'note.second_cerveau',
      ]);
    });
  });
});
