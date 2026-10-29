import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { contacts, entreprises } from '../crm/schema.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import {
  demanderEnregistrement,
  demanderProposition,
  enregistrerCapitalisation,
  rendezVousCapitalisables,
} from './capitalisation.js';
import {
  attentesClaude,
  ChatIndisponible,
  demarrerAttente,
  finirAttente,
  repondreClaude,
} from './chat.js';
import { SupportInvalide } from './support.js';
import { createProjet, listProjets, updateProjet } from './service.js';

describe('Diagnostic : capitalisation de la restitution', () => {
  let t: TestApp;
  let simatis: Instance;
  let entrepriseId: string;
  let autreEntrepriseId: string;

  beforeAll(async () => {
    t = await setupTestApp();
    simatis = await createInstance(t.owner.db, {
      slug: 'simatis-capi',
      nom: 'SIMATIS',
      type: 'propre',
    });
    const [a, b] = await t.owner.db
      .insert(entreprises)
      .values([
        { instanceId: simatis.id, nom: 'Entreprise Fictive Capi A' },
        { instanceId: simatis.id, nom: 'Entreprise Fictive Capi B' },
      ])
      .returning({ id: entreprises.id });
    entrepriseId = a!.id;
    autreEntrepriseId = b!.id;
  });
  afterAll(async () => {
    await t.drop();
  });

  // Un rendez-vous relié à l'entreprise ; compteRendu null = pas de compte rendu écrit.
  const rdv = async (
    eventId: string,
    entreprise: string,
    compteRendu: string | null,
    debut = '2026-10-29T14:00:00Z',
    statut = 'rdv',
  ) => {
    const { rows } = await t.owner.pool.query<{ id: string }>(
      `insert into rendez_vous (instance_id, event_id, titre, debut, statut, compte_rendu, compte_rendu_at)
       values ($1, $2, $3, $4, $5, $6, case when $6::text is null then null else now() end) returning id`,
      [simatis.id, eventId, `Restitution ${eventId}`, debut, statut, compteRendu],
    );
    await t.owner.pool.query(
      'insert into rdv_entreprises (instance_id, rendez_vous_id, entreprise_id) values ($1, $2, $3)',
      [simatis.id, rows[0]!.id, entreprise],
    );
    return rows[0]!.id;
  };
  const projet = async (nom: string, avecEntreprise = true, etape = 5) => {
    const p = await createProjet(t.app.db, simatis, {
      nom,
      activite: 'services',
      entrepriseId: avecEntreprise ? entrepriseId : null,
    });
    await updateProjet(t.app.db, simatis, p.id, { etape });
    return p;
  };
  const relu = async (id: string) =>
    (await listProjets(t.app.db, simatis)).find((p) => p.id === id)!;
  const cycleProposition = async (id: string) => {
    await demarrerAttente(t.app.db, simatis, id);
    await withInstance(t.app.db, simatis.id, (tx) =>
      repondreClaude(tx, id, 'Proposition fictive.'),
    );
    await finirAttente(t.app.db, simatis, id);
  };

  it('liste seulement les rendez-vous avec compte rendu de l’entreprise du projet, du plus récent au plus ancien', async () => {
    await rdv('l-ancien', entrepriseId, 'Compte rendu ancien', '2026-10-01T09:00:00Z');
    await rdv('l-recent', entrepriseId, 'Compte rendu récent', '2026-10-29T09:00:00Z');
    await rdv('l-sans', entrepriseId, null);
    await rdv('l-ignore', entrepriseId, 'Écarté', '2026-10-30T09:00:00Z', 'ignore');
    await rdv('l-autre', autreEntrepriseId, 'Autre entreprise');
    const p = await projet('Capi Liste');
    const liste = await rendezVousCapitalisables(t.app.db, simatis, p.id);
    expect(liste.map((r) => r.titre)).toEqual(['Restitution l-recent', 'Restitution l-ancien']);
  });

  it('trouve aussi le rendez-vous relié seulement au contact du projet, ou à une affaire de l’entreprise', async () => {
    const [c, autreC] = await t.owner.db
      .insert(contacts)
      .values([
        { instanceId: simatis.id, nom: 'Contact Fictif Capi' },
        { instanceId: simatis.id, nom: 'Autre Contact Fictif Capi' },
      ])
      .returning({ id: contacts.id });
    const [e] = await t.owner.db
      .insert(entreprises)
      .values({ instanceId: simatis.id, nom: 'Entreprise Fictive Capi C' })
      .returning({ id: entreprises.id });
    const lierContact = async (rdvId: string, contactId: string) =>
      t.owner.pool.query(
        'insert into rdv_contacts (instance_id, rendez_vous_id, contact_id) values ($1, $2, $3)',
        [simatis.id, rdvId, contactId],
      );
    const affaire = async (entrepriseId: string) => {
      const { rows } = await t.owner.pool.query<{ id: string }>(
        `insert into opportunites (instance_id, titre, etape) values ($1, 'Affaire fictive', 'detection') returning id`,
        [simatis.id],
      );
      await t.owner.pool.query(
        'insert into affaire_entreprises (instance_id, opportunite_id, entreprise_id) values ($1, $2, $3)',
        [simatis.id, rows[0]!.id, entrepriseId],
      );
      return rows[0]!.id;
    };
    const lierAffaire = (rdvId: string, opportuniteId: string) =>
      t.owner.pool.query(
        'insert into rdv_affaires (instance_id, rendez_vous_id, opportunite_id) values ($1, $2, $3)',
        [simatis.id, rdvId, opportuniteId],
      );
    const parContact = await rdv('x-contact', e!.id, 'Compte rendu par le contact');
    await t.owner.pool.query('delete from rdv_entreprises where rendez_vous_id = $1', [parContact]);
    await lierContact(parContact, c!.id);
    const parAffaire = await rdv('x-affaire', e!.id, 'Compte rendu par l’affaire');
    await t.owner.pool.query('delete from rdv_entreprises where rendez_vous_id = $1', [parAffaire]);
    await lierAffaire(parAffaire, await affaire(e!.id));
    const autreAffaire = await rdv('x-autre-affaire', e!.id, 'Affaire d’une autre entreprise');
    await t.owner.pool.query('delete from rdv_entreprises where rendez_vous_id = $1', [
      autreAffaire,
    ]);
    await lierAffaire(autreAffaire, await affaire(autreEntrepriseId));
    const autreContact = await rdv('x-autre-contact', e!.id, 'Contact d’un autre dossier');
    await t.owner.pool.query('delete from rdv_entreprises where rendez_vous_id = $1', [
      autreContact,
    ]);
    await lierContact(autreContact, autreC!.id);

    const p = await createProjet(t.app.db, simatis, {
      nom: 'Capi Liens',
      activite: 'services',
      entrepriseId: e!.id,
      contactId: c!.id,
    });
    const liste = await rendezVousCapitalisables(t.app.db, simatis, p.id);
    expect(liste.map((r) => r.id).sort()).toEqual([parContact, parAffaire].sort());
  });

  it('renvoie une liste vide pour un projet sans entreprise', async () => {
    const p = await projet('Capi Sans Entreprise', false);
    expect(await rendezVousCapitalisables(t.app.db, simatis, p.id)).toEqual([]);
  });

  it('refuse un rendez-vous d’une autre entreprise, ou sans compte rendu', async () => {
    const autre = await rdv('r-autre', autreEntrepriseId, 'Autre');
    const sans = await rdv('r-sans', entrepriseId, null);
    const p = await projet('Capi Refus');
    await expect(demanderProposition(t.app.db, simatis, p.id, autre)).rejects.toBeInstanceOf(
      ChatIndisponible,
    );
    await expect(demanderProposition(t.app.db, simatis, p.id, sans)).rejects.toBeInstanceOf(
      ChatIndisponible,
    );
  });

  it('refuse la proposition avant l’étape 5', async () => {
    const id = await rdv('e-4', entrepriseId, 'Compte rendu');
    const p = await projet('Capi Étape 4', true, 4);
    await expect(demanderProposition(t.app.db, simatis, p.id, id)).rejects.toThrow(/étape 5/);
  });

  it('refuse d’enregistrer sans proposition', async () => {
    const p = await projet('Capi Sans Proposition');
    await expect(demanderEnregistrement(t.app.db, simatis, p.id)).rejects.toBeInstanceOf(
      ChatIndisponible,
    );
  });

  it('enchaîne proposer, répondre puis enregistrer jusqu’à « enregistre »', async () => {
    const id = await rdv('c-flux', entrepriseId, 'Compte rendu du flux');
    const p = await projet('Capi Flux');
    const demande = await demanderProposition(t.app.db, simatis, p.id, id);
    expect(demande.demande).toBe('capitalisation_proposer');
    expect(demande.capitalisationStatut).toBe('en_cours');
    expect(demande.capitalisationRdvId).toBe(id);

    const attente = (await attentesClaude(t.app.db)).find((a) => a.id === p.id)!;
    expect(attente.compteRendu).toBe('Compte rendu du flux');

    await cycleProposition(p.id);
    expect((await relu(p.id)).capitalisationStatut).toBe('propose');

    await demanderEnregistrement(t.app.db, simatis, p.id);
    const attente2 = (await attentesClaude(t.app.db)).find((a) => a.id === p.id)!;
    expect(attente2.demande).toBe('capitalisation_enregistrer');
    expect(attente2.capitalisationProposition).toBe('Proposition fictive.');
    await demarrerAttente(t.app.db, simatis, p.id);
    await withInstance(t.app.db, simatis.id, (tx) => enregistrerCapitalisation(tx, p.id));
    await withInstance(t.app.db, simatis.id, (tx) => repondreClaude(tx, p.id, 'Enregistré.'));
    await finirAttente(t.app.db, simatis, p.id);
    const fini = await relu(p.id);
    expect(fini.capitalisationStatut).toBe('enregistre');
    expect(fini.capitalisationCompteRenduAt).not.toBeNull();
  });

  it('refuse l’outil d’enregistrement hors de cette demande', async () => {
    const p = await projet('Capi Outil');
    await expect(
      withInstance(t.app.db, simatis.id, (tx) => enregistrerCapitalisation(tx, p.id)),
    ).rejects.toBeInstanceOf(SupportInvalide);
  });

  it('refuse de recapituler le même compte rendu, puis le permet une fois modifié', async () => {
    const id = await rdv('c-doublon', entrepriseId, 'Compte rendu initial');
    const p = await projet('Capi Doublon');
    await demanderProposition(t.app.db, simatis, p.id, id);
    await cycleProposition(p.id);
    await demanderEnregistrement(t.app.db, simatis, p.id);
    await demarrerAttente(t.app.db, simatis, p.id);
    await withInstance(t.app.db, simatis.id, (tx) => enregistrerCapitalisation(tx, p.id));
    await finirAttente(t.app.db, simatis, p.id);

    await expect(demanderProposition(t.app.db, simatis, p.id, id)).rejects.toThrow(/déjà/);

    await t.owner.pool.query(
      `update rendez_vous set compte_rendu = 'Compte rendu corrigé', compte_rendu_at = now() + interval '1 hour' where id = $1`,
      [id],
    );
    await expect(demanderProposition(t.app.db, simatis, p.id, id)).resolves.toBeDefined();
  });

  it('sans réponse de Claude, la proposition revient à « aucun »', async () => {
    const id = await rdv('c-silence', entrepriseId, 'Compte rendu silencieux');
    const p = await projet('Capi Silence');
    await demanderProposition(t.app.db, simatis, p.id, id);
    await demarrerAttente(t.app.db, simatis, p.id);
    await finirAttente(t.app.db, simatis, p.id);
    const fini = await relu(p.id);
    expect(fini.capitalisationStatut).toBe('aucun');
    expect(fini.statutChat).toBe('repos');
  });
});
