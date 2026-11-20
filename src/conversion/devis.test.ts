import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { seedDemoIfEmpty } from '../demo/seed.js';
import { getInstanceBySlug } from '../instances/service.js';
import type { Instance } from '../instances/schema.js';
import { calculer } from './devis-contenu.js';
import {
  creerDepuisAffaire,
  DevisRefuse,
  listerDevis,
  lireDevis,
  modifierContenu,
  nouvelleVersion,
  validerDevis,
} from './devis.js';

describe('Devis : création depuis l’affaire, contenu et versions', () => {
  let t: TestApp;
  let simatis: Instance;
  let affaires: string[];

  beforeAll(async () => {
    t = await setupTestApp();
    await seedDemoIfEmpty(t.owner.db);
    simatis = (await getInstanceBySlug(t.app.db, 'simatis'))!;
    const { rows } = await t.owner.pool.query<{ id: string }>(
      "select id from opportunites where instance_id = $1 and clos is null and etape in ('qualification', 'proposition', 'negociation') order by titre limit 4",
      [simatis.id],
    );
    affaires = rows.map((r) => r.id);
    // 0 : récurrente 900 €/mois sur 6 mois ; 1 : sans montant ni entreprise ; 2 et 3 : telles quelles.
    await t.owner.pool.query(
      "update opportunites set mode_facturation = 'recurrent', montant = 900, duree_engagement_mois = 6 where id = $1",
      [affaires[0]],
    );
    await t.owner.pool.query(
      'update opportunites set montant = null, entreprise_id = null, contact_id = null where id = $1',
      [affaires[1]],
    );
  });

  afterAll(async () => {
    await t.drop();
  });

  // An open affair with no quote yet, moved into the Pipeline (a Radar affair gets no quote).
  const affaireLibre = async () => {
    const { rows } = await t.owner.pool.query<{ id: string }>(
      'select id from opportunites where instance_id = $1 and clos is null and id not in (select opportunite_id from devis) limit 1',
      [simatis.id],
    );
    await t.owner.pool.query("update opportunites set etape = 'qualification' where id = $1", [
      rows[0]!.id,
    ]);
    return rows[0]!.id;
  };

  const contenuDe = async (id: string) => {
    const d = await lireDevis(t.app.db, simatis, id);
    return {
      titre: d.titre,
      contexte: d.contexte,
      objectifs: d.objectifs,
      inclus: d.inclus,
      exclu: d.exclu,
      livrables: d.livrables,
      debut: d.debut,
      duree: d.duree,
      lignes: d.lignes,
      remisePct: d.remisePct,
      acomptePct: d.acomptePct,
      frais: d.frais,
      fraisPlafond: d.fraisPlafond,
      fraisTexte: d.fraisTexte,
      modePrix: d.modePrix,
      sortieMois: d.sortieMois,
      texteSortie: d.texteSortie,
      conditionsParticulieres: d.conditionsParticulieres,
      validiteJours: d.validiteJours,
      clauses: d.clauses,
      adresse: d.adresse,
      attention: d.attention,
    };
  };

  it('reprend l’affaire récurrente en mensuel × durée, prix à fixer, montant seulement proposé', async () => {
    const { devis, existant } = await creerDepuisAffaire(t.app.db, simatis, affaires[0]!);
    expect(existant).toBe(false);
    expect(devis.lignes).toEqual([
      expect.objectContaining({
        unite: 'mois',
        quantite: 6,
        prixUnitaire: null,
        prixPropose: 900,
      }),
    ]);
    expect(calculer(devis).prixManquant).toBe(true);
    expect(devis.validiteJours).toBe(30);
    // Une affaire récurrente se lit comme un abonnement : une ligne, mensualité et engagement.
    expect(devis.modePrix).toBe('abonnement');
    expect(devis.numero).toBe(`DEV-${new Date().getFullYear()}-001`);
  });

  it('rouvre le devis existant au lieu d’en créer un second', async () => {
    const premier = await creerDepuisAffaire(t.app.db, simatis, affaires[0]!);
    expect(premier.existant).toBe(true);
    const { rows } = await t.owner.pool.query('select id from devis where opportunite_id = $1', [
      affaires[0],
    ]);
    expect(rows).toHaveLength(1);
  });

  it('crée un devis pour une affaire sans montant ni entreprise', async () => {
    const { devis } = await creerDepuisAffaire(t.app.db, simatis, affaires[1]!);
    expect(devis.lignes[0]?.prixPropose ?? null).toBeNull();
    expect(devis.lignes[0]?.unite).toBe('forfait');
    const lu = await lireDevis(t.app.db, simatis, devis.id);
    expect(lu.entreprise).toBeNull();
  });

  it('refuse une affaire inconnue', async () => {
    await expect(creerDepuisAffaire(t.app.db, simatis, crypto.randomUUID())).rejects.toBeInstanceOf(
      DevisRefuse,
    );
  });

  it('un nouveau devis reprend les clauses du devis le plus récent', async () => {
    const premier = (await listerDevis(t.app.db, simatis))[0]!;
    const contenu = await contenuDe(premier.id);
    await modifierContenu(t.app.db, simatis, premier.id, {
      ...contenu,
      clauses: [{ titre: 'Clause fictive', texte: 'Texte fictif', active: true }],
    });
    const { devis } = await creerDepuisAffaire(t.app.db, simatis, affaires[2]!);
    expect(devis.clauses).toEqual([
      { titre: 'Clause fictive', texte: 'Texte fictif', active: true },
    ]);
  });

  it('valide seulement avec tous les prix et un périmètre inclus', async () => {
    const { devis } = await creerDepuisAffaire(t.app.db, simatis, affaires[3]!);
    const base = await contenuDe(devis.id);
    await expect(validerDevis(t.app.db, simatis, devis.id)).rejects.toThrow(/prix/);
    const prix = {
      ...base,
      lignes: base.lignes.map((l) => ({ ...l, prixUnitaire: 1000 })),
    };
    await modifierContenu(t.app.db, simatis, devis.id, { ...prix, inclus: '' });
    await expect(validerDevis(t.app.db, simatis, devis.id)).rejects.toThrow(/périmètre/);
    await modifierContenu(t.app.db, simatis, devis.id, { ...prix, inclus: 'Une prestation' });
    expect((await validerDevis(t.app.db, simatis, devis.id)).statut).toBe('valide');
  });

  it('un devis validé ne se modifie plus et son contenu reste intact', async () => {
    const valide = (await listerDevis(t.app.db, simatis)).find((d) => d.statut === 'valide')!;
    const avant = await contenuDe(valide.id);
    await expect(
      modifierContenu(t.app.db, simatis, valide.id, { ...avant, titre: 'Autre titre' }),
    ).rejects.toBeInstanceOf(DevisRefuse);
    expect(await contenuDe(valide.id)).toEqual(avant);
  });

  it('enchaîne les versions sans collision de numéro et laisse l’original intact', async () => {
    const valide = (await listerDevis(t.app.db, simatis)).find((d) => d.statut === 'valide')!;
    const v2 = await nouvelleVersion(t.app.db, simatis, valide.id);
    expect(v2).toMatchObject({ version: 2, statut: 'brouillon', numero: `${valide.numero}-V2` });
    await expect(nouvelleVersion(t.app.db, simatis, valide.id)).rejects.toBeInstanceOf(DevisRefuse);
    await validerDevis(t.app.db, simatis, v2.id);
    const v3 = await nouvelleVersion(t.app.db, simatis, v2.id);
    expect(v3.numero).toBe(`${valide.numero}-V3`);
    expect((await lireDevis(t.app.db, simatis, valide.id)).statut).toBe('valide');
  });

  it('la liste ne garde que la dernière version de chaque devis', async () => {
    const liste = await listerDevis(t.app.db, simatis);
    const chaine = liste.filter((d) => d.numero.includes('-V'));
    expect(chaine).toHaveLength(1);
    expect(chaine[0]).toMatchObject({ version: 3, versions: 3 });
    expect(chaine[0]?.totaux.prixManquant).toBe(false);
  });

  it('refuse de valider avec un titre ou un libellé de ligne vide, mais enregistre le brouillon', async () => {
    const rows = [{ id: await affaireLibre() }];
    const { devis } = await creerDepuisAffaire(t.app.db, simatis, rows[0]!.id);
    const base = await contenuDe(devis.id);
    const vide = {
      ...base,
      titre: '',
      inclus: 'Une prestation',
      lignes: base.lignes.map((l) => ({ ...l, libelle: '', prixUnitaire: 100 })),
    };
    await modifierContenu(t.app.db, simatis, devis.id, vide);
    await expect(validerDevis(t.app.db, simatis, devis.id)).rejects.toThrow(/intitulé|libellé/);
  });

  it('deux créations simultanées pour la même affaire donnent un seul devis', async () => {
    const rows = [{ id: await affaireLibre() }];
    const [a, b] = await Promise.all([
      creerDepuisAffaire(t.app.db, simatis, rows[0]!.id),
      creerDepuisAffaire(t.app.db, simatis, rows[0]!.id),
    ]);
    expect(a.devis.id).toBe(b.devis.id);
    expect([a.existant, b.existant].sort()).toEqual([false, true]);
  });

  it('deux nouvelles versions simultanées : une seule passe', async () => {
    const derniere = (await listerDevis(t.app.db, simatis)).find((d) => d.numero.includes('-V'))!;
    const valide = await validerDevis(t.app.db, simatis, derniere.id);
    const r = await Promise.allSettled([
      nouvelleVersion(t.app.db, simatis, valide.id),
      nouvelleVersion(t.app.db, simatis, valide.id),
    ]);
    expect(r.map((x) => x.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect((r.find((x) => x.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(
      DevisRefuse,
    );
  });

  it('refuse une nouvelle version d’un brouillon et un identifiant qui n’est pas un UUID', async () => {
    const brouillon = (await listerDevis(t.app.db, simatis)).find((d) => d.statut === 'brouillon')!;
    await expect(nouvelleVersion(t.app.db, simatis, brouillon.id)).rejects.toThrow(/brouillon/);
    await expect(lireDevis(t.app.db, simatis, 'abc')).rejects.toBeInstanceOf(DevisRefuse);
  });

  it('garde l’adresse et l’attention saisies, et la version suivante les reprend', async () => {
    const { devis } = await creerDepuisAffaire(t.app.db, simatis, await affaireLibre());
    const avant = await contenuDe(devis.id);
    expect(avant.adresse).toBe('');
    expect(avant.attention).toBe('');
    await modifierContenu(t.app.db, simatis, devis.id, {
      ...avant,
      adresse: '12 rue Fictive\n71200 Ville Fictive',
      attention: 'Alex Fictif',
      lignes: avant.lignes.map((l) => ({ ...l, prixUnitaire: 100 })),
      inclus: 'Une prestation',
    });
    const lu = await lireDevis(t.app.db, simatis, devis.id);
    expect(lu.adresse).toBe('12 rue Fictive\n71200 Ville Fictive');
    // Saisi, « à l’attention de » prend la place du contact de l’affaire.
    expect(lu.contact).toBe('Alex Fictif');
    await validerDevis(t.app.db, simatis, devis.id);
    const v2 = await nouvelleVersion(t.app.db, simatis, devis.id);
    expect(v2).toMatchObject({ adresse: lu.adresse, attention: 'Alex Fictif' });
  });

  it('un abonnement exige une seule ligne et une sortie pendant l’engagement ; tout passe à la version suivante', async () => {
    const { devis } = await creerDepuisAffaire(t.app.db, simatis, await affaireLibre());
    const base = await contenuDe(devis.id);
    const ligne = {
      libelle: 'Abonnement',
      unite: 'mois' as const,
      quantite: 12,
      prixUnitaire: 2500,
    };
    const abonne = {
      ...base,
      inclus: 'Une prestation',
      modePrix: 'abonnement' as const,
      lignes: [ligne],
      sortieMois: 6,
      texteSortie: 'Engagement de 12 mois, sortie possible dès le 6e mois.',
      frais: 'plafonnes' as const,
      fraisPlafond: 60,
      fraisTexte: 'Plafonnés à 60 € HT par aller-retour.',
      conditionsParticulieres: 'Condition fictive.',
    };
    await modifierContenu(t.app.db, simatis, devis.id, {
      ...abonne,
      lignes: [ligne, { ...ligne, libelle: 'Autre' }],
    });
    await expect(validerDevis(t.app.db, simatis, devis.id)).rejects.toThrow(/une seule ligne/);
    await modifierContenu(t.app.db, simatis, devis.id, { ...abonne, sortieMois: 13 });
    await expect(validerDevis(t.app.db, simatis, devis.id)).rejects.toThrow(/pendant l’engagement/);
    await modifierContenu(t.app.db, simatis, devis.id, abonne);
    await validerDevis(t.app.db, simatis, devis.id);
    const v2 = await nouvelleVersion(t.app.db, simatis, devis.id);
    expect(v2).toMatchObject({
      modePrix: 'abonnement',
      sortieMois: 6,
      texteSortie: abonne.texteSortie,
      frais: 'plafonnes',
      fraisPlafond: 60,
      fraisTexte: abonne.fraisTexte,
      conditionsParticulieres: 'Condition fictive.',
    });
  });
});
