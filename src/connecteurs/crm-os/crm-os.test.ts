import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../../test/database.js';
import { configureConnexion, registerConnector, syncConnexion } from '../../connexions/service.js';
import { updateFiche } from '../../crm/fiches.js';
import { changeOpportunite, pipelineSource } from '../../crm/pipeline.js';
import { CrmIndisponible } from '../../crm/service.js';
import { updateTache } from '../../crm/taches.js';
import { withInstance } from '../../db/context.js';
import type { Instance } from '../../instances/schema.js';
import { createInstance } from '../../instances/service.js';
import { validerUrl, crmOsClient, CrmOsError, type FicheCrmOs } from './client.js';
import { crmOsConnector } from './index.js';
import { mapActivite, mapAffaire, mapContact, mapEntreprise, mapTache } from './mapping.js';

// Fictitious data only: nothing here comes from a real CRM.
const JETON = 'jeton-fictif-0000';
const URL_CRM = 'https://crm.exemple.test';

const fiche = (
  id: string,
  champs: Record<string, unknown>,
  liens: FicheCrmOs['liens'] = {},
  modifie_le = '2026-01-01T10:00:00.000Z',
): FicheCrmOs => ({ id, source: 'natif', source_id: null, modifie_le, champs, liens });

type Donnees = Record<
  'entreprise' | 'contact' | 'affaire' | 'tache' | 'rendez_vous' | 'activite',
  FicheCrmOs[]
> & {
  __suppressions?: FicheCrmOs[];
};
const donneesDeBase = (): Donnees => ({
  entreprise: [
    fiche('e1', {
      nom: 'Société Un',
      secteur: 'Industrie',
      ville: 'Ville-Test',
      taille: 20,
      domaine: 'un.test',
    }),
    fiche('e2', { nom: 'Société Deux', secteur: null, ville: null, taille: null, domaine: null }),
  ],
  contact: [
    fiche(
      'c1',
      {
        nom: 'Alex Exemple',
        fonction: 'DG',
        email: 'alex@un.test',
        emails: ['alex@un.test', 'alex2@un.test'],
        telephone: '0100000000',
        role: null,
      },
      { entreprises: ['e1', 'e2'] },
    ),
  ],
  affaire: [
    fiche(
      'a1',
      {
        titre: 'Projet fictif',
        etape: 'proposition',
        montant: 12000,
        echeance: '2027-02-01',
        clos: null,
        motif: null,
        proprietaire: 'Pilote',
        origine: 'Salon',
        prochaine_etape: 'Relancer',
        mode_facturation: 'recurrent',
        duree_engagement_mois: 24,
        tacite_reconduction: false,
        probabilite_manuelle: 70,
        derniere_activite: null,
        etapes_dates: { proposition: '2026-01-01T10:00:00.000Z' },
        qualification: { besoin: 3, decideur: 2, budget: 2, timing: 1, engagement: 1 },
        potentiel: null,
        faisabilite: null,
      },
      { contacts: ['c1'], entreprises: ['e1'] },
    ),
  ],
  tache: [
    fiche(
      't1',
      {
        titre: 'Appeler Alex',
        type: 'appel',
        echeance: '2027-01-10T09:00:00.000Z',
        avec_heure: true,
        duree_minutes: 15,
        occupe: false,
        fait_at: null,
        notes: null,
      },
      { contact: 'c1', entreprise: 'e1', affaire: 'a1' },
    ),
  ],
  rendez_vous: [],
  activite: [
    fiche(
      'n1',
      { type: 'note', at: '2026-12-01T10:00:00.000Z', titre: 'Note', resume: 'Texte fictif' },
      { contact: null, entreprise: null, affaire: 'a1' },
    ),
  ],
});

// A fake exchange API of the compatible CRM, with the paging and the `depuis` window of the real one.
function fauxCrm(donnees: Donnees) {
  const appels: string[] = [];
  let panne: number | null = null;
  const reponse = (corps: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(corps), { status }));
  const fetchFaux = ((url: string, init?: RequestInit) => {
    appels.push(url);
    if (panne) return reponse({}, panne);
    if ((init?.headers as Record<string, string>).authorization !== `Bearer ${JETON}`)
      return reponse({}, 401);
    const u = new URL(url);
    const chemin = u.pathname.replace('/api/echange', '');
    if (chemin === '') return reponse({ profil: 'crm/1', objets: [] });
    if (chemin === '/etapes') {
      return reponse({
        etapes: [
          {
            id: 'detection',
            label: 'Détection',
            ordre: 1,
            clos: false,
            gagne: false,
            probabilite: 10,
          },
          {
            id: 'proposition',
            label: 'Proposition',
            ordre: 2,
            clos: false,
            gagne: false,
            probabilite: 60,
          },
        ],
      });
    }
    if (chemin === '/suppressions')
      return reponse(
        donnees.__suppressions
          ? donnees.__suppressions.map((f) => ({ objet: 'contact', id: f.id }))
          : [],
      );
    const liste = (donnees as Record<string, FicheCrmOs[] | undefined>)[chemin.slice(1)] ?? [];
    const depuis = u.searchParams.get('depuis');
    const limite = Number(u.searchParams.get('limite') ?? 200);
    const decalage = Number(u.searchParams.get('decalage') ?? 0);
    return reponse(
      liste.filter((f) => !depuis || f.modifie_le >= depuis).slice(decalage, decalage + limite),
    );
  }) as unknown as typeof fetch;
  return {
    fetch: fetchFaux,
    appels,
    panne: (s: number | null) => {
      panne = s;
    },
  };
}

describe('client du CRM compatible', () => {
  const secrets = { CRM_OS_URL: URL_CRM, CRM_OS_TOKEN: JETON };

  it('exige https, sauf pour la machine locale et le conteneur', () => {
    expect(() => validerUrl('http://crm.exemple.test')).toThrow(/https/);
    expect(() => validerUrl('pas une adresse')).toThrow(CrmOsError);
    expect(validerUrl('http://localhost:4400/chemin')).toBe('http://localhost:4400');
    expect(validerUrl('http://host.docker.internal:4400')).toBe('http://host.docker.internal:4400');
    expect(validerUrl('https://crm.exemple.test/x')).toBe(URL_CRM);
  });

  it('exige le jeton et envoie le jeton Bearer', async () => {
    expect(() => crmOsClient({ CRM_OS_URL: URL_CRM })).toThrow(/CRM_OS_TOKEN/);
    const crm = fauxCrm(donneesDeBase());
    await crmOsClient(secrets, { fetch: crm.fetch }).verifier();
    await expect(
      crmOsClient({ ...secrets, CRM_OS_TOKEN: 'faux' }, { fetch: crm.fetch }).verifier(),
    ).rejects.toThrow(/refuse le jeton/);
  });

  it('lit toutes les pages et passe la date de départ', async () => {
    const donnees = donneesDeBase();
    donnees.entreprise = Array.from({ length: 450 }, (_, i) => fiche(`x${i}`, { nom: `E${i}` }));
    const crm = fauxCrm(donnees);
    const lues = await crmOsClient(secrets, { fetch: crm.fetch }).fiches('entreprise', null);
    expect(lues).toHaveLength(450);
    expect(crm.appels).toHaveLength(3);
    await crmOsClient(secrets, { fetch: crm.fetch }).fiches(
      'contact',
      new Date('2026-02-03T04:05:06Z'),
    );
    expect(crm.appels.at(-1)).toContain('depuis=2026-02-03T04%3A05%3A06.000Z');
  });

  it('signale un serveur injoignable ou un profil inattendu', async () => {
    const mort = (() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof fetch;
    await expect(crmOsClient(secrets, { fetch: mort }).verifier()).rejects.toThrow(/injoignable/);
    const autre = (() =>
      Promise.resolve(new Response(JSON.stringify({ profil: 'x/9' })))) as unknown as typeof fetch;
    await expect(crmOsClient(secrets, { fetch: autre }).verifier()).rejects.toThrow(/inattendu/);
  });
});

describe('correspondance CRM OS → OS', () => {
  it('ignore une fiche sans champ obligatoire et neutralise les mauvais types', () => {
    expect(mapEntreprise(fiche('x', { nom: '  ' }))).toBeNull();
    expect(mapContact(fiche('x', { nom: null }))).toBeNull();
    expect(mapAffaire(fiche('x', { titre: 'T' }))).toBeNull();
    expect(mapTache(fiche('x', { titre: '' }))).toBeNull();
    expect(mapActivite(fiche('x', { type: 'inconnu', at: '2026-01-01T00:00:00Z' }))).toBeNull();
    expect(mapEntreprise(fiche('x', { nom: 'A', taille: 'beaucoup', ville: 12 }))).toMatchObject({
      taille: null,
      ville: null,
    });
  });

  it('déduit le canal du type de la tâche et garde les valeurs par défaut', () => {
    expect(mapTache(fiche('x', { titre: 'T', type: 'email' }))).toMatchObject({
      canal: 'email',
      type: 'email',
    });
    expect(mapTache(fiche('x', { titre: 'T', type: 'reunion' }))).toMatchObject({ canal: 'tache' });
    expect(mapTache(fiche('x', { titre: 'T', type: 'bizarre' }))).toMatchObject({
      type: 'tache',
      avecHeure: false,
    });
    expect(mapAffaire(fiche('x', { titre: 'T', etape: 'e' }))!.creation).toMatchObject({
      modeFacturation: 'spot',
      dureeEngagementMois: 12,
      taciteReconduction: true,
      qualification: null,
    });
  });
});

describe('miroir du CRM compatible', () => {
  let t: TestApp;
  let a: Instance;
  let secretsDir: string;
  let donnees: Donnees;
  let crm: ReturnType<typeof fauxCrm>;

  const deps = () => ({ secretsDir, realWrites: false });
  const inA = <T>(fn: Parameters<typeof withInstance<T>>[2]) => withInstance(t.app.db, a.id, fn);
  const lignes = async <R extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await t.owner.pool.query<R>(sql, [a.id, ...params])).rows;
  const idDe = async (table: string, sourceId: string) =>
    (
      await lignes<{ id: string }>(
        `select id from ${table} where instance_id = $1 and source = 'crm-os' and source_id = $2`,
        [sourceId],
      )
    )[0]!.id;

  beforeAll(async () => {
    t = await setupTestApp();
    a = await createInstance(t.owner.db, {
      slug: 'mandat-crm-os',
      nom: 'Mandat CRM OS',
      type: 'mandat',
    });
    secretsDir = await mkdtemp(path.join(tmpdir(), 'simatis-crm-os-'));
    await writeFile(
      path.join(secretsDir, 'mandat-crm-os.env'),
      `CRM_OS_URL=${URL_CRM}\nCRM_OS_TOKEN=${JETON}\n`,
    );
    donnees = donneesDeBase();
    crm = fauxCrm(donnees);
    registerConnector(crmOsConnector({ fetch: crm.fetch }));
    await inA((tx) =>
      configureConnexion(tx, {
        kind: 'crm',
        fournisseur: 'crm-os',
        reglages: { frequence: 'manuel' },
      }),
    );
  });
  afterAll(async () => {
    await t.drop();
    await rm(secretsDir, { recursive: true, force: true });
  });
  beforeEach(() => {
    crm.appels.length = 0;
    crm.panne(null);
  });

  it('copie entreprises, contacts, affaires, tâches et historique, avec leurs liens', async () => {
    const rapport = await syncConnexion(t.app.db, a, 'crm', deps());
    expect(rapport).toMatchObject({ lus: 6, crees: 6, maj: 0, erreurs: [] });

    const [e] = await lignes<{ nom: string; ville: string; taille: number; domaine: string }>(
      "select nom, ville, taille, domaine from entreprises where instance_id = $1 and source_id = 'e1'",
    );
    expect(e).toEqual({ nom: 'Société Un', ville: 'Ville-Test', taille: 20, domaine: 'un.test' });

    const contact = await lignes<{ nom: string; entreprise: string; email: string }>(
      `select c.nom, e.nom as entreprise, c.email from contacts c join entreprises e on e.id = c.entreprise_id where c.instance_id = $1`,
    );
    expect(contact).toEqual([
      { nom: 'Alex Exemple', entreprise: 'Société Un', email: 'alex@un.test' },
    ]);
    const adresses = await lignes<{ email: string }>(
      'select email from contact_emails where instance_id = $1 order by email',
    );
    expect(adresses.map((x) => x.email)).toEqual(['alex2@un.test', 'alex@un.test']);
    const liensContact = await lignes<{ nom: string; source: string; principal: boolean }>(
      `select e.nom, l.source, l.principal from contact_entreprises l join entreprises e on e.id = l.entreprise_id where l.instance_id = $1 order by e.nom`,
    );
    expect(liensContact).toEqual([
      { nom: 'Société Deux', source: 'crm-os', principal: false },
      { nom: 'Société Un', source: 'crm-os', principal: true },
    ]);

    const [affaire] = await lignes<Record<string, unknown>>(
      `select o.titre, o.etape, o.montant, o.echeance::text as echeance, o.mode_facturation, o.duree_engagement_mois, o.qualification, e.nom as entreprise, c.nom as contact
       from opportunites o join entreprises e on e.id = o.entreprise_id join contacts c on c.id = o.contact_id where o.instance_id = $1`,
    );
    expect(affaire).toMatchObject({
      titre: 'Projet fictif',
      etape: 'proposition',
      montant: 12000,
      echeance: '2027-02-01',
      mode_facturation: 'recurrent',
      duree_engagement_mois: 24,
      entreprise: 'Société Un',
      contact: 'Alex Exemple',
    });
    expect(affaire!.qualification).toMatchObject({ besoin: 3 });

    const [tache] = await lignes<{ titre: string; canal: string; opp: string; contact: string }>(
      `select t.titre, t.canal, o.titre as opp, c.nom as contact from taches t join opportunites o on o.id = t.opportunite_id join contacts c on c.id = t.contact_id where t.instance_id = $1`,
    );
    expect(tache).toEqual({
      titre: 'Appeler Alex',
      canal: 'appel',
      opp: 'Projet fictif',
      contact: 'Alex Exemple',
    });
    const [act] = await lignes<{ resume: string; opp: string }>(
      `select a.resume, o.titre as opp from activites a join opportunites o on o.id = a.opportunite_id where a.instance_id = $1`,
    );
    expect(act).toEqual({ resume: 'Texte fictif', opp: 'Projet fictif' });

    const [{ reglages }] = (await lignes<{ reglages: { etapes: { id: string }[] } }>(
      "select reglages from connexions where instance_id = $1 and kind = 'crm'",
    )) as [{ reglages: { etapes: { id: string }[] } }];
    expect(reglages.etapes.map((x) => x.id)).toEqual(['detection', 'proposition']);
  });

  it('n’écrit rien dans le CRM compatible : que des lectures', () => {
    expect(crm.appels.length).toBe(0);
    expect('write' in crmOsConnector()).toBe(false);
  });

  it('relit seulement ce qui a changé et ne crée aucun doublon', async () => {
    const rapport = await syncConnexion(t.app.db, a, 'crm', deps());
    expect(rapport.crees).toBe(0);
    expect(crm.appels.some((u) => u.includes('depuis='))).toBe(true);
    expect(
      (
        await lignes<{ n: number }>(
          'select count(*)::int as n from entreprises where instance_id = $1',
        )
      )[0]!.n,
    ).toBe(2);
  });

  it('met à jour les champs reflétés, mais laisse ceux de l’OS et les liens faits dans l’OS', async () => {
    const idAffaire = await idDe('opportunites', 'a1');
    // a contact created in the OS, linked to the deal in the OS only
    const natif = (
      await t.owner.pool.query<{ id: string }>(
        "insert into contacts (instance_id, nom) values ($1, 'Contact natif') returning id",
        [a.id],
      )
    ).rows[0]!.id;
    await t.owner.pool.query(
      'update opportunites set prochaine_etape = \'Choisie dans l\'\'OS\', probabilite_manuelle = 10, qualification = \'{"besoin":0,"decideur":0,"budget":0,"timing":0,"engagement":0}\' where id = $1',
      [idAffaire],
    );
    // un lien fait dans l'OS seulement
    await t.owner.pool.query(
      "insert into affaire_contacts (instance_id, opportunite_id, contact_id, source) values ($1, $2, $3, 'natif')",
      [a.id, idAffaire, natif],
    );
    donnees.affaire[0] = fiche(
      'a1',
      {
        ...donnees.affaire[0]!.champs,
        titre: 'Projet renommé',
        etape: 'detection',
        montant: 15000,
        prochaine_etape: 'Autre',
        probabilite_manuelle: 99,
      },
      { contacts: [], entreprises: ['e1'] },
      '2026-06-01T10:00:00.000Z',
    );
    await t.owner.pool.query(
      "update connexions set derniere_synchro = '2026-05-01T00:00:00Z' where instance_id = $1",
      [a.id],
    );
    const rapport = await syncConnexion(t.app.db, a, 'crm', deps());
    expect(rapport.maj).toBeGreaterThanOrEqual(1);

    const [o] = await lignes<Record<string, unknown>>(
      'select titre, etape, montant, prochaine_etape, probabilite_manuelle, qualification from opportunites where instance_id = $1 and id = $2',
      [idAffaire],
    );
    expect(o).toMatchObject({
      titre: 'Projet renommé',
      etape: 'detection',
      montant: 15000,
      prochaine_etape: "Choisie dans l'OS",
      probabilite_manuelle: 10,
    });
    expect(o!.qualification).toMatchObject({ besoin: 0 });
    const liens = await lignes<{ contact_id: string; source: string }>(
      'select contact_id, source from affaire_contacts where instance_id = $1 and opportunite_id = $2',
      [idAffaire],
    );
    expect(liens).toEqual([{ contact_id: natif, source: 'natif' }]);
  });

  it('garde le type et les liens d’une tâche choisis dans l’OS', async () => {
    const id = await idDe('taches', 't1');
    await t.owner.pool.query(
      "update taches set type = 'dejeuner', canal = 'tache', type_choisi = true, contact_id = null, lien_choisi = true where id = $1",
      [id],
    );
    donnees.tache[0] = fiche(
      't1',
      { ...donnees.tache[0]!.champs, titre: 'Appeler Alex (maj)', type: 'appel' },
      { contact: 'c1', entreprise: 'e1', affaire: 'a1' },
      '2026-07-01T10:00:00.000Z',
    );
    await t.owner.pool.query(
      "update connexions set derniere_synchro = '2026-06-15T00:00:00Z' where instance_id = $1",
      [a.id],
    );
    await syncConnexion(t.app.db, a, 'crm', deps());
    const [x] = await lignes<{ titre: string; type: string; contact_id: string | null }>(
      'select titre, type, contact_id from taches where instance_id = $1 and id = $2',
      [id],
    );
    expect(x).toEqual({ titre: 'Appeler Alex (maj)', type: 'dejeuner', contact_id: null });
  });

  it('signale une fiche invalide sans bloquer les autres', async () => {
    donnees.entreprise.push(
      fiche('e3', { nom: '' }, {}, '2026-08-01T10:00:00.000Z'),
      fiche('e4', { nom: 'Société Quatre' }, {}, '2026-08-01T10:00:00.000Z'),
    );
    await t.owner.pool.query(
      "update connexions set derniere_synchro = '2026-07-15T00:00:00Z' where instance_id = $1",
      [a.id],
    );
    const rapport = await syncConnexion(t.app.db, a, 'crm', deps());
    expect(rapport.erreurs).toEqual([expect.stringContaining('Entreprise e3 ignoré')]);
    expect(
      await lignes('select 1 from entreprises where instance_id = $1 and source_id = $2', ['e4']),
    ).toHaveLength(1);
  });

  it('ne supprime jamais une copie : une suppression est seulement journalisée', async () => {
    donnees.__suppressions = [fiche('c1', {})];
    await t.owner.pool.query(
      "update connexions set derniere_synchro = '2026-09-01T00:00:00Z' where instance_id = $1",
      [a.id],
    );
    await syncConnexion(t.app.db, a, 'crm', deps());
    expect(
      await lignes('select 1 from contacts where instance_id = $1 and source_id = $2', ['c1']),
    ).toHaveLength(1);
    const journal = await lignes<{ action: string }>(
      "select action from journal where instance_id = $1 and action like '%supprimée%'",
    );
    expect(journal.length).toBeGreaterThan(0);
  });

  it('refuse une synchro sans accès, et note l’erreur sur la connexion', async () => {
    crm.panne(500);
    await expect(syncConnexion(t.app.db, a, 'crm', deps())).rejects.toThrow(/erreur 500/);
    const [c] = await lignes<{ etat: string; derniere_erreur: string }>(
      "select etat, derniere_erreur from connexions where instance_id = $1 and kind = 'crm'",
    );
    expect(c!.etat).toBe('erreur');
  });

  it('les copies sont en lecture seule dans l’OS, les fiches natives restent modifiables', async () => {
    const idAffaire = await idDe('opportunites', 'a1');
    const idTache = await idDe('taches', 't1');
    await expect(
      updateFiche(t.app.db, a, 'affaire', idAffaire, { titre: 'Changé dans l’OS' }, deps()),
    ).rejects.toThrow(CrmIndisponible);
    await expect(
      changeOpportunite(t.app.db, a, idAffaire, { etape: 'detection' }, deps()),
    ).rejects.toThrow(/lecture seule/);
    await expect(updateTache(t.app.db, a, idTache, { titre: 'Changée' }, deps())).rejects.toThrow(
      /lecture seule/,
    );

    const { rows } = await t.owner.pool.query<{ id: string }>(
      "insert into opportunites (instance_id, titre, etape) values ($1, 'Affaire native', 'detection') returning id",
      [a.id],
    );
    const natif = rows[0]!.id;
    await changeOpportunite(t.app.db, a, natif, { etape: 'proposition' }, deps());
    const [n] = await lignes<{ etape: string }>(
      'select etape from opportunites where instance_id = $1 and id = $2',
      [natif],
    );
    expect(n!.etape).toBe('proposition');
  });

  it('le pipeline montre les étapes du CRM compatible, en lecture seule', async () => {
    const src = await inA((tx) => pipelineSource(tx));
    expect(src).toMatchObject({ source: 'crm-os', ecrit: false, hubspot: null });
    expect(src.etapes.map((e) => e.id)).toEqual(['detection', 'proposition']);
  });
});
