import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { withInstance } from '../db/context.js';
import { createInstance } from '../instances/service.js';
import {
  creerCampagne,
  messageEffectif,
  LIMITE_INVITATION,
  listerModeles,
  ModeleInvalide,
  rendre,
  retirerSurcharge,
  sauverModele,
  sauverSurcharge,
  supprimerCampagne,
} from './modeles.js';

// Textes fictifs : les vrais messages se saisissent dans l'OS, jamais dans le dépôt.
describe('Modèles de messages Sales Navigator', () => {
  let t: TestApp;
  let a: string;
  let b: string;

  beforeAll(async () => {
    t = await setupTestApp();
    a = (await createInstance(t.owner.db, { slug: 'sn-a', nom: 'A', type: 'mandat' })).id;
    b = (await createInstance(t.owner.db, { slug: 'sn-b', nom: 'B', type: 'mandat' })).id;
  });

  afterAll(async () => {
    await t.drop();
  });

  const dansA = <T>(fn: Parameters<typeof withInstance<T>>[2]) => withInstance(t.app.db, a, fn);
  const refus = (p: Promise<unknown>) => expect(p).rejects.toBeInstanceOf(ModeleInvalide);

  it('enregistre un modèle par défaut puis le remplace', async () => {
    await dansA((tx) => sauverModele(tx, 'cible-1', 'acceptation', 'Merci {prénom}.'));
    await dansA((tx) => sauverModele(tx, 'cible-1', 'acceptation', 'Merci {prénom}, à bientôt.'));
    const liste = await dansA((tx) => listerModeles(tx));
    expect(liste).toEqual([
      { icp: 'cible-1', etape: 'acceptation', texte: 'Merci {prénom}, à bientôt.' },
    ]);
  });

  it('refuse un texte vide, une étape inconnue et une cible vide', async () => {
    await refus(dansA((tx) => sauverModele(tx, 'cible-1', 'relance1', '   ')));
    await refus(dansA((tx) => sauverModele(tx, 'cible-1', 'autre', 'Texte')));
    await refus(dansA((tx) => sauverModele(tx, ' ', 'relance1', 'Texte')));
  });

  it(`limite la note d'invitation à ${LIMITE_INVITATION} caractères`, async () => {
    await dansA((tx) => sauverModele(tx, 'cible-1', 'invitation', 'x'.repeat(LIMITE_INVITATION)));
    await refus(
      dansA((tx) => sauverModele(tx, 'cible-1', 'invitation', 'x'.repeat(LIMITE_INVITATION + 1))),
    );
  });

  it('utilise le modèle par défaut tant que la campagne ne le remplace pas', async () => {
    await dansA((tx) => sauverModele(tx, 'cible-2', 'relance1', 'Relance par défaut'));
    const c = await dansA((tx) => creerCampagne(tx, { nom: 'Lot de test', icp: 'cible-2' }));
    expect(await dansA((tx) => messageEffectif(tx, c.id, 'relance1'))).toEqual({
      texte: 'Relance par défaut',
      origine: 'defaut',
    });
  });

  it('une surcharge de campagne passe avant le modèle, sans le modifier', async () => {
    const c = await dansA((tx) => creerCampagne(tx, { nom: 'Autre lot', icp: 'cible-2' }));
    await dansA((tx) => sauverSurcharge(tx, c.id, 'relance1', 'Relance propre à ce lot'));
    expect(await dansA((tx) => messageEffectif(tx, c.id, 'relance1'))).toEqual({
      texte: 'Relance propre à ce lot',
      origine: 'campagne',
    });
    const defauts = await dansA((tx) => listerModeles(tx));
    expect(defauts.find((m) => m.icp === 'cible-2')?.texte).toBe('Relance par défaut');
  });

  it('un changement du modèle par défaut se répercute sur la campagne qui ne le remplace pas', async () => {
    const c = await dansA((tx) => creerCampagne(tx, { nom: 'Lot suiveur', icp: 'cible-2' }));
    await dansA((tx) => sauverModele(tx, 'cible-2', 'relance1', 'Relance révisée'));
    expect((await dansA((tx) => messageEffectif(tx, c.id, 'relance1'))).texte).toBe(
      'Relance révisée',
    );
  });

  it('retirer la surcharge ramène au modèle par défaut', async () => {
    const c = await dansA((tx) => creerCampagne(tx, { nom: 'Lot retour', icp: 'cible-2' }));
    await dansA((tx) => sauverSurcharge(tx, c.id, 'relance1', 'Version du lot'));
    await dansA((tx) => retirerSurcharge(tx, c.id, 'relance1'));
    expect((await dansA((tx) => messageEffectif(tx, c.id, 'relance1'))).origine).toBe('defaut');
  });

  it("applique aussi la limite d'invitation à la surcharge", async () => {
    const c = await dansA((tx) => creerCampagne(tx, { nom: 'Lot long', icp: 'cible-2' }));
    await refus(
      dansA((tx) => sauverSurcharge(tx, c.id, 'invitation', 'x'.repeat(LIMITE_INVITATION + 1))),
    );
  });

  it('refuse une campagne sans nom ou au nom déjà pris', async () => {
    await refus(dansA((tx) => creerCampagne(tx, { nom: '  ', icp: 'cible-2' })));
    await dansA((tx) => creerCampagne(tx, { nom: 'Doublon', icp: 'cible-2' }));
    await refus(dansA((tx) => creerCampagne(tx, { nom: 'Doublon', icp: 'cible-2' })));
  });

  it('supprimer une campagne emporte ses surcharges et laisse les modèles par défaut', async () => {
    const c = await dansA((tx) => creerCampagne(tx, { nom: 'À supprimer', icp: 'cible-2' }));
    await dansA((tx) => sauverSurcharge(tx, c.id, 'relance2', 'Texte du lot'));
    await dansA((tx) => supprimerCampagne(tx, c.id));
    await expect(dansA((tx) => messageEffectif(tx, c.id, 'relance2'))).rejects.toBeInstanceOf(
      ModeleInvalide,
    );
    expect((await dansA((tx) => listerModeles(tx))).some((m) => m.icp === 'cible-2')).toBe(true);
  });

  it('garde chaque espace séparé', async () => {
    await withInstance(t.app.db, b, (tx) => sauverModele(tx, 'cible-2', 'relance1', 'Texte de B'));
    const vuB = await withInstance(t.app.db, b, (tx) => listerModeles(tx));
    expect(vuB).toEqual([{ icp: 'cible-2', etape: 'relance1', texte: 'Texte de B' }]);
    const vuA = await dansA((tx) => listerModeles(tx));
    expect(vuA.some((m) => m.texte === 'Texte de B')).toBe(false);
  });

  it("remplit le prénom et l'entreprise, et signale les variables sans valeur", () => {
    expect(
      rendre('Bonjour {prénom}, chez {entreprise} ?', { prenom: 'Julie', entreprise: 'Atelier X' }),
    ).toEqual({ texte: 'Bonjour Julie, chez Atelier X ?', manquantes: [], longueur: 31 });
    expect(rendre('Bonjour {prénom}, chez {entreprise} ?', { prenom: 'Julie' })).toMatchObject({
      texte: 'Bonjour Julie, chez {entreprise} ?',
      manquantes: ['entreprise'],
    });
  });
});
