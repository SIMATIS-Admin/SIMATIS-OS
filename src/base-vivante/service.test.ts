import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { fabriquerXlsx } from '../../test/xlsx.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { registerBaseVivanteRoutes } from './routes.js';
import {
  annulerImport,
  apercu,
  completerLigne,
  creerImports,
  enrichirFiche,
  ImportRefuse,
  integrerImport,
  listerFiches,
  reglerCorrespondance,
} from './service.js';

// Deliberately dirty, fictitious file: shifted header, title rows, mixed name cells, a duplicate.
const FICHIER = [
  'Salon fictif 2026;;;;',
  'Export du 12/10;;;;',
  'Tél. direct;Contact;Raison sociale;E-mail pro;Code interne',
  '06 12 34 56 78;jean DUPONT;Atelier Fictif;;A1',
  ';MARTIN Claire;Bureau Fictif;claire@bureau-fictif.test;A2',
  ';Paul Petit;Cabinet Fictif;;A3',
  ';Marie Durand;;;A4',
  ';;Boutique Fictive;;A5',
  '04 50 12 34 56;Claire Martin;Bureau Fictif;CLAIRE@bureau-fictif.test;A6',
  ';Luc Bon;;luc@societe-fictive.test;A7',
].join('\n');

type ImportCree = { id: string; compteurs: { prospectables: number } };
type Liste = {
  fiches: unknown[];
  compteurs: unknown;
  imports: { statut: string }[];
  total: number;
};

describe('base vivante : chaîne d’import', () => {
  let t: TestApp;
  let mandat: Instance;
  let autre: Instance;

  beforeAll(async () => {
    t = await setupTestApp();
    mandat = await createInstance(t.owner.db, { slug: 'bv-mandat', nom: 'Mandat', type: 'mandat' });
    autre = await createInstance(t.owner.db, { slug: 'bv-autre', nom: 'Autre', type: 'mandat' });
  });
  afterAll(async () => {
    await t.drop();
  });
  beforeEach(async () => {
    for (const table of [
      'base_lignes_brutes',
      'base_vivante',
      'base_imports',
      'base_correspondances',
    ])
      await t.owner.pool.query(`delete from ${table}`);
  });

  const importer = async (provenance = 'Sharp', contenu = FICHIER, instance = mandat) => {
    const [imp] = await creerImports(t.app.db, instance.id, {
      nomFichier: 'liste.csv',
      contenu: Buffer.from(contenu),
      provenance,
    });
    if (!imp) throw new Error('aucun import');
    return imp;
  };

  it('lit le fichier sale : en-tête retrouvée, colonnes reconnues, lignes classées', async () => {
    const imp = await importer();
    expect(imp.entetes).toEqual([
      'Tél. direct',
      'Contact',
      'Raison sociale',
      'E-mail pro',
      'Code interne',
    ]);
    expect(imp.correspondance).toEqual({ telephone: 0, nomComplet: 1, entreprise: 2, email: 3 });
    expect(imp.inconnues).toEqual([4]);
    expect(imp.compteurs).toEqual({
      total: 7,
      // Jean Dupont (téléphone), Claire Martin (email), Luc Bon (email, entreprise déduite)
      prospectables: 3,
      aEnrichir: 2, // Paul Petit (sans moyen de contact), Boutique Fictive (sans nom)
      sousMinimum: 1, // Marie Durand (sans entreprise)
      doublonsInternes: 1, // Claire Martin, ligne 6
      integrees: 0,
    });
    const claire = imp.lignes.find((l) => l.fiche.nom === 'MARTIN');
    expect(claire?.fiche).toMatchObject({
      prenom: 'Claire',
      civilite: 'Mme',
      civiliteDeduite: true,
      email: 'claire@bureau-fictif.test',
      // Merged from the duplicate line, which only had the phone.
      telephone: '+33450123456',
    });
  });

  it('classe les lignes sous le minimum avec leur raison', async () => {
    const imp = await apercu(t.app.db, mandat.id, (await importer()).id, 'sous_minimum');
    expect(imp.lignes.map((l) => [l.brut[1], l.raison])).toEqual([
      ['Marie Durand', 'Entreprise manquante'],
    ]);
  });

  it('n’écrit rien dans la base avant la validation', async () => {
    await importer();
    expect((await listerFiches(t.app.db, mandat.id)).total).toBe(0);
  });

  it('intègre les lignes prêtes dans les bonnes zones et laisse les autres dans le sas', async () => {
    const imp = await importer();
    const rapport = await integrerImport(t.app.db, mandat.id, imp.id);
    expect(rapport).toEqual({ creees: 5, fusionnees: 0, restantes: 1 });
    const base = await listerFiches(t.app.db, mandat.id);
    expect(base.compteurs).toEqual({ aEnrichir: 2, prospectable: 3 });
    expect(base.fiches.map((f) => [f.entreprise, f.nom, f.zone])).toEqual([
      ['Atelier Fictif', 'DUPONT', 'prospectable'],
      ['Boutique Fictive', '', 'a_enrichir'],
      ['Bureau Fictif', 'MARTIN', 'prospectable'],
      ['Cabinet Fictif', 'PETIT', 'a_enrichir'],
      ['Societe Fictive', 'BON', 'prospectable'],
    ]);
    expect(base.fiches[0]).toMatchObject({ provenance: 'Sharp', telephone: '+33612345678' });
    const apres = await apercu(t.app.db, mandat.id, imp.id);
    expect(apres.statut).toBe('integre');
    expect(apres.compteurs.integrees).toBe(5);
  });

  it('rejouer l’intégration ne crée rien de plus', async () => {
    const imp = await importer();
    await integrerImport(t.app.db, mandat.id, imp.id);
    expect(await integrerImport(t.app.db, mandat.id, imp.id)).toMatchObject({
      creees: 0,
      fusionnees: 0,
    });
    expect((await listerFiches(t.app.db, mandat.id)).total).toBe(5);
  });

  it('un second fichier fusionne avec la base sans doublon ni écrasement', async () => {
    await integrerImport(t.app.db, mandat.id, (await importer('Sharp')).id);
    const second = [
      'Société,Prénom,Nom,Email,Téléphone,Fonction',
      'Cabinet Fictif,Paul,Petit,paul@cabinet-fictif.test,,Gérant',
      'Atelier Fictif,Jean,Dupont,,0699999999,Directeur',
      'Nouvelle Entreprise,Zoé,Neuve,zoe@nouvelle.test,,',
    ].join('\n');
    const imp = await importer('LinkedIn', second);
    const rapport = await integrerImport(t.app.db, mandat.id, imp.id);
    expect(rapport).toMatchObject({ creees: 1, fusionnees: 2 });
    const { fiches, compteurs, total } = await listerFiches(t.app.db, mandat.id);
    expect(total).toBe(6);
    // Paul Petit gained an email: « à enrichir » → « prospectable ». The company alone stays.
    expect(compteurs).toEqual({ aEnrichir: 1, prospectable: 5 });
    const paul = fiches.find((f) => f.nom === 'PETIT');
    expect(paul).toMatchObject({
      email: 'paul@cabinet-fictif.test',
      fonction: 'Gérant',
      provenance: 'Sharp',
    });
    // Jean Dupont keeps his first phone number; the new one does not replace it.
    const jean = fiches.find((f) => f.nom === 'DUPONT');
    expect(jean).toMatchObject({ telephone: '+33612345678', fonction: 'Directeur' });
  });

  it('mémorise la correspondance par source : un format déjà vu passe sans question', async () => {
    const premier = await importer('Sharp');
    await integrerImport(t.app.db, mandat.id, premier.id);
    // « Code interne » was left unmapped; a column renamed by the supplier is now known.
    const autreOrdre = ['Code interne;Raison sociale;Contact', 'B1;Atelier Neuf;Paul Petit'].join(
      '\n',
    );
    const imp = await importer('Sharp', autreOrdre);
    expect(imp.correspondance).toEqual({ entreprise: 1, nomComplet: 2 });
    expect(imp.inconnues).toEqual([0]);
    const sansMemoire = await importer('Autre source', autreOrdre);
    expect(sansMemoire.correspondance).toEqual({ entreprise: 1, nomComplet: 2 });
  });

  it('applique la correction manuelle d’une colonne à toutes les lignes', async () => {
    const imp = await importer();
    const corrige = await reglerCorrespondance(t.app.db, mandat.id, imp.id, {
      telephone: 0,
      nomComplet: 1,
      entreprise: 2,
      email: 3,
      fonction: 4,
    });
    expect(corrige.correspondance.fonction).toBe(4);
    expect(corrige.compteurs.total).toBe(7);
    expect(corrige.lignes[0]?.fiche.fonction).toBe('A1');
    await expect(
      reglerCorrespondance(t.app.db, mandat.id, imp.id, { nom: 1, prenom: 1 }),
    ).rejects.toThrow(ImportRefuse);
    await expect(reglerCorrespondance(t.app.db, mandat.id, imp.id, { email: 99 })).rejects.toThrow(
      ImportRefuse,
    );
  });

  it('une ligne du sas se complète puis s’intègre à la relance', async () => {
    const imp = await importer();
    await integrerImport(t.app.db, mandat.id, imp.id);
    const ligne = await completerLigne(t.app.db, mandat.id, imp.id, 4, {
      entreprise: 'Maison Fictive',
    });
    expect(ligne).toMatchObject({ statut: 'pret', zone: 'a_enrichir', raison: null });
    expect(ligne.fiche).toMatchObject({ entreprise: 'Maison Fictive', nom: 'DURAND' });
    expect(await integrerImport(t.app.db, mandat.id, imp.id)).toMatchObject({
      creees: 1,
      restantes: 0,
    });
    expect((await listerFiches(t.app.db, mandat.id)).total).toBe(6);
    await expect(completerLigne(t.app.db, mandat.id, imp.id, 1, { nom: 'X' })).rejects.toThrow(
      ImportRefuse,
    );
  });

  it('une entreprise sans contact entre « à enrichir », puis un contact la rend prospectable', async () => {
    const liste = ['Raison sociale;Email', 'Atelier Seul;', 'Atelier Seul;', 'Garage Seul;'].join(
      '\n',
    );
    const imp = await importer('Shaarp', liste);
    expect(imp.compteurs).toMatchObject({ aEnrichir: 2, sousMinimum: 0, doublonsInternes: 1 });
    expect(await integrerImport(t.app.db, mandat.id, imp.id)).toMatchObject({ creees: 2 });
    // Importing the same list again finds the same companies instead of duplicating them.
    const encore = await importer('Shaarp', liste);
    expect(await integrerImport(t.app.db, mandat.id, encore.id)).toMatchObject({
      creees: 0,
      fusionnees: 2,
    });
    const base = await listerFiches(t.app.db, mandat.id);
    expect(base.compteurs).toEqual({ aEnrichir: 2, prospectable: 0 });
    const fiche = base.fiches.find((f) => f.entreprise === 'Atelier Seul');
    if (!fiche) throw new Error('fiche absente');

    await expect(
      enrichirFiche(t.app.db, mandat.id, fiche.id, { email: 'pas-un-mail' }),
    ).rejects.toThrow();
    expect(
      await enrichirFiche(t.app.db, mandat.id, fiche.id, { prenom: 'Léa', nom: 'martin' }),
    ).toEqual({
      zone: 'a_enrichir',
    });
    expect(
      await enrichirFiche(t.app.db, mandat.id, fiche.id, { email: 'lea@atelier-seul.test' }),
    ).toEqual({ zone: 'prospectable' });
    const apres = (await listerFiches(t.app.db, mandat.id)).fiches.find((f) => f.id === fiche.id);
    expect(apres).toMatchObject({
      prenom: 'Léa',
      nom: 'MARTIN',
      civilite: 'Mme',
      email: 'lea@atelier-seul.test',
      zone: 'prospectable',
    });
    expect((await listerFiches(t.app.db, mandat.id)).compteurs).toEqual({
      aEnrichir: 1,
      prospectable: 1,
    });
  });

  it('annule un import non intégré, pas un import intégré', async () => {
    const a = await importer();
    await annulerImport(t.app.db, mandat.id, a.id);
    await expect(apercu(t.app.db, mandat.id, a.id)).rejects.toThrow('introuvable');
    const b = await importer();
    await integrerImport(t.app.db, mandat.id, b.id);
    await expect(annulerImport(t.app.db, mandat.id, b.id)).rejects.toThrow(ImportRefuse);
  });

  it('crée un import par onglet Excel', async () => {
    const xlsx = fabriquerXlsx([
      {
        nom: 'Nord',
        lignes: [
          ['Société', 'Nom', 'Email'],
          ['Atelier Fictif', 'Durand', 'd@atelier-fictif.test'],
        ],
      },
      {
        nom: 'Sud',
        lignes: [
          ['Société', 'Nom'],
          ['Bureau Fictif', 'Petit'],
        ],
      },
    ]);
    const imports = await creerImports(t.app.db, mandat.id, {
      nomFichier: 'regions.xlsx',
      contenu: xlsx,
      provenance: 'Salon',
    });
    expect(
      imports.map((i) => [i.feuille, i.compteurs.prospectables, i.compteurs.aEnrichir]),
    ).toEqual([
      ['Nord', 1, 0],
      ['Sud', 0, 1],
    ]);
  });

  it('accepte du texte collé', async () => {
    const [imp] = await creerImports(t.app.db, mandat.id, {
      nomFichier: 'Texte collé',
      texte: 'Société\tNom\tMail\nAtelier Fictif\tDurand\td@atelier-fictif.test',
      provenance: 'Copier-coller',
    });
    expect(imp?.compteurs.prospectables).toBe(1);
  });

  it('sans en-tête reconnaissable, tout reste dans le sas en attendant la correspondance', async () => {
    const imp = await importer('Brut', 'Atelier Fictif;Durand\nBureau Fictif;Petit');
    expect(imp.entetes).toEqual(['Colonne 1', 'Colonne 2']);
    expect(imp.compteurs).toMatchObject({ total: 2, sousMinimum: 2 });
    const corrige = await reglerCorrespondance(t.app.db, mandat.id, imp.id, {
      entreprise: 0,
      nom: 1,
    });
    expect(corrige.compteurs).toMatchObject({ aEnrichir: 2, sousMinimum: 0 });
  });

  it('lit une colonne « Nom » unique comme « Prénom Nom »', async () => {
    const imp = await importer(
      'SalesNav',
      'Nom;Entreprise;Poste\nJean Dupont;Atelier Fictif;Directeur\nClaire Martin;Bureau Fictif;Gérante',
    );
    expect(imp.correspondance).toMatchObject({ nomComplet: 0, entreprise: 1, fonction: 2 });
    expect(imp.lignes[0]?.fiche).toMatchObject({ prenom: 'Jean', nom: 'DUPONT' });
  });

  it('laisse de côté un onglet de synthèse sans entreprise ni nom', async () => {
    const xlsx = fabriquerXlsx([
      { nom: 'Synthese', lignes: [['Email'], ['total : 3']] },
      {
        nom: 'Liste',
        lignes: [
          ['Société', 'Nom'],
          ['Atelier Fictif', 'Durand'],
        ],
      },
    ]);
    const imports = await creerImports(t.app.db, mandat.id, {
      nomFichier: 'x.xlsx',
      contenu: xlsx,
      provenance: 'Marc',
    });
    expect(imports.map((i) => i.feuille)).toEqual(['Liste']);
  });

  it('cloisonne les instances', async () => {
    const imp = await importer();
    await integrerImport(t.app.db, mandat.id, imp.id);
    expect((await listerFiches(t.app.db, autre.id)).total).toBe(0);
    await expect(apercu(t.app.db, autre.id, imp.id)).rejects.toThrow('introuvable');
  });

  it('traite 20 000 lignes par lots', async () => {
    const lignes = ['Société;Nom;Email'];
    for (let i = 0; i < 20_000; i++)
      lignes.push(`Entreprise ${i % 5000};Contact ${i};contact${i}@entreprise${i % 5000}.test`);
    const imp = await importer('Gros fichier', lignes.join('\n'));
    expect(imp.compteurs).toMatchObject({ total: 20_000, prospectables: 20_000 });
    const rapport = await integrerImport(t.app.db, mandat.id, imp.id);
    expect(rapport.creees).toBe(20_000);
    expect((await listerFiches(t.app.db, mandat.id)).total).toBe(20_000);
  }, 180_000);

  describe('API', () => {
    const app = () => {
      const a = Fastify();
      registerBaseVivanteRoutes(a, { db: t.app.db });
      return a;
    };

    it('crée un import, l’aperçoit, l’intègre, puis liste la base', async () => {
      const a = app();
      const creation = await a.inject({
        method: 'POST',
        url: '/api/i/bv-mandat/base/imports',
        payload: {
          nomFichier: 'liste.csv',
          contenuBase64: Buffer.from(FICHIER).toString('base64'),
          provenance: 'Sharp',
          mandat: 'Mandat fictif',
        },
      });
      expect(creation.statusCode).toBe(200);
      const [imp] = creation.json<ImportCree[]>();
      if (!imp) throw new Error('aucun import');
      expect(imp.compteurs.prospectables).toBe(3);

      const integration = await a.inject({
        method: 'POST',
        url: `/api/i/bv-mandat/base/imports/${imp.id}/integrer`,
      });
      expect(integration.json()).toEqual({ creees: 5, fusionnees: 0, restantes: 1 });

      const liste = await a.inject({ method: 'GET', url: '/api/i/bv-mandat/base?zone=a_enrichir' });
      expect(liste.json<Liste>().fiches).toHaveLength(2);
      expect(liste.json<Liste>().compteurs).toEqual({ aEnrichir: 2, prospectable: 3 });
      expect(liste.json<Liste>().imports[0]?.statut).toBe('integre');
      const recherche = await a.inject({ method: 'GET', url: '/api/i/bv-mandat/base?q=bureau' });
      expect(recherche.json<Liste>().total).toBe(1);
    });

    it('refuse un import sans source, sans contenu, ou illisible', async () => {
      const a = app();
      const post = (payload: object) =>
        a.inject({ method: 'POST', url: '/api/i/bv-mandat/base/imports', payload });
      expect((await post({ nomFichier: 'a.csv', texte: 'x', provenance: '' })).statusCode).toBe(
        400,
      );
      expect((await post({ nomFichier: 'a.csv', provenance: 'S' })).statusCode).toBe(400);
      const xls = Buffer.from([0xd0, 0xcf, 0x11, 0xe0]).toString('base64');
      const res = await post({ nomFichier: 'a.xls', contenuBase64: xls, provenance: 'S' });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ error: string }>().error).toMatch(/\.xlsx/);
    });

    it('répond 404 pour une instance ou un import inconnu, 400 pour un identifiant invalide', async () => {
      const a = app();
      expect((await a.inject({ method: 'GET', url: '/api/i/inconnue/base' })).statusCode).toBe(404);
      const absent = '00000000-0000-4000-8000-000000000000';
      expect(
        (await a.inject({ method: 'GET', url: `/api/i/bv-mandat/base/imports/${absent}` }))
          .statusCode,
      ).toBe(404);
      expect(
        (await a.inject({ method: 'GET', url: '/api/i/bv-mandat/base/imports/pas-un-uuid' }))
          .statusCode,
      ).toBe(400);
    });
  });
});
