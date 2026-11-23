import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insererFiche } from '../../test/fiche-base.js';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { withInstance } from '../db/context.js';
import { createInstance } from '../instances/service.js';
import { ActionRefusee, indicateurs } from './actions.js';
import {
  ajouterProspect,
  disponiblesDansLaBase,
  ecarter,
  enregistrerMessage,
  listerProspects,
  marquerConnecte,
  marquerDemandeEnvoyee,
  marquerReponse,
  marquerSansReponse,
  normaliserLien,
  ProspectInvalide,
  proposerDuJour,
  statsPipe,
} from './prospects.js';
import { sauverReglages } from './reglages.js';

// Personnes et entreprises fictives.
describe('Pipe SalesNav', () => {
  let t: TestApp;
  let a: string;
  let b: string;

  beforeAll(async () => {
    t = await setupTestApp();
    a = (await createInstance(t.owner.db, { slug: 'pp-a', nom: 'A', type: 'mandat' })).id;
    b = (await createInstance(t.owner.db, { slug: 'pp-b', nom: 'B', type: 'mandat' })).id;
  });

  afterAll(async () => {
    await t.drop();
  });

  const dansA = <T>(fn: Parameters<typeof withInstance<T>>[2]) => withInstance(t.app.db, a, fn);
  const fiche = (n: number, extra: Record<string, unknown> = {}) =>
    insererFiche(t.owner.db, {
      instanceId: a,
      zone: 'prospectable',
      entreprise: `Atelier Fictif ${n}`,
      prenom: 'Camille',
      nom: `Dupré${n}`,
      fonction: 'Gérante',
      provenance: 'Test',
      linkedin: `https://www.linkedin.com/in/fictif-${n}/`,
      ...extra,
    });
  const lien = (n: number) => `https://www.linkedin.com/in/manuel-${n}`;

  it('normalise un lien et refuse ce qui n’en est pas un', () => {
    expect(normaliserLien('https://WWW.linkedin.com/in/Fictif-1/?utm=x')).toBe(
      'https://www.linkedin.com/in/Fictif-1',
    );
    expect(() => normaliserLien('fictif')).toThrow(ProspectInvalide);
    expect(() => normaliserLien('https://exemple.test/in/fictif')).toThrow(ProspectInvalide);
  });

  it('ajoute un profil à la main, proposé tout de suite, une seule fois', async () => {
    const p = await dansA((tx) =>
      ajouterProspect(tx, { lien: `${lien(1)}/`, nom: 'Alex Fictif', entreprise: 'Atelier X' }),
    );
    expect(p).toMatchObject({ statut: 'propose', lienLinkedin: lien(1), nom: 'Alex Fictif' });
    await expect(
      dansA((tx) => ajouterProspect(tx, { lien: lien(1), nom: 'Alex Fictif' })),
    ).rejects.toBeInstanceOf(ProspectInvalide);
    await expect(
      dansA((tx) => ajouterProspect(tx, { lien: lien(2), nom: '  ' })),
    ).rejects.toBeInstanceOf(ProspectInvalide);
  });

  it('propose de quoi atteindre le quota, en piochant dans la Base des suspects', async () => {
    await dansA((tx) => sauverReglages(tx, { quotaJour: 4 }));
    for (let n = 1; n <= 6; n++) await fiche(n);
    // Déjà contacté, opposé, exclu, sans lien : jamais proposés.
    await fiche(7, { statutProspection: 'contacte' });
    await fiche(8, { opposition: true });
    await fiche(9, { exclusion: 'client' });
    await fiche(10, { linkedin: null });
    expect(await dansA((tx) => disponiblesDansLaBase(tx))).toBe(6);
    // 1 profil déjà proposé à la main : il en manque 3.
    const r = await dansA((tx) => proposerDuJour(tx));
    expect(r).toEqual({ proposes: 3, manque: 0 });
    const proposes = (await dansA((tx) => listerProspects(tx))).filter(
      (p) => p.statut === 'propose',
    );
    expect(proposes).toHaveLength(4);
    expect(await dansA((tx) => disponiblesDansLaBase(tx))).toBe(3);
    // Rien de plus tant que les propositions n'ont pas été traitées.
    expect(await dansA((tx) => proposerDuJour(tx))).toEqual({ proposes: 0, manque: 0 });
  });

  it('ne propose rien quand le canal est en pause', async () => {
    await dansA((tx) => sauverReglages(tx, { quotaJour: 10, pause: true }));
    expect(await dansA((tx) => proposerDuJour(tx))).toEqual({ proposes: 0, manque: 0 });
    await dansA((tx) => sauverReglages(tx, { pause: false }));
  });

  it('suit la personne de la proposition à la réponse et compte tout', async () => {
    const [p] = (await dansA((tx) => listerProspects(tx))).filter((x) => x.statut === 'propose');
    await dansA((tx) => marquerDemandeEnvoyee(tx, p!.id));
    await dansA((tx) => marquerConnecte(tx, p!.id));
    await dansA((tx) => enregistrerMessage(tx, p!.id));
    await dansA((tx) => enregistrerMessage(tx, p!.id));
    await dansA((tx) => marquerReponse(tx, p!.id));
    const apres = (await dansA((tx) => listerProspects(tx))).find((x) => x.id === p!.id)!;
    expect(apres).toMatchObject({ statut: 'a_repondu', nbMessages: 2 });
    expect(apres.demandeLe && apres.accepteLe && apres.reponduLe).toBeTruthy();
    const s = await dansA((tx) => statsPipe(tx));
    expect(s).toMatchObject({
      demandesEnvoyees: 1,
      acceptees: 1,
      tauxAcceptation: 100,
      messagesEnvoyes: 2,
      reponses: 1,
      tauxReponse: 100,
    });
    const i = await dansA((tx) => indicateurs(tx));
    expect(i.jour).toMatchObject({ demande_envoyee: 1, message_envoye: 2, reponse_recue: 1 });
  });

  it('calcule les taux sur les demandes envoyées, et rien tant qu’il n’y en a pas', async () => {
    const vide = await withInstance(t.app.db, b, (tx) => statsPipe(tx));
    expect(vide).toMatchObject({ demandesEnvoyees: 0, tauxAcceptation: null, tauxReponse: null });
    const [p, q] = (await dansA((tx) => listerProspects(tx))).filter((x) => x.statut === 'propose');
    await dansA((tx) => marquerDemandeEnvoyee(tx, p!.id));
    await dansA((tx) => marquerDemandeEnvoyee(tx, q!.id));
    await dansA((tx) => marquerConnecte(tx, p!.id));
    const s = await dansA((tx) => statsPipe(tx));
    expect(s.demandesEnvoyees).toBe(3);
    expect(s.acceptees).toBe(2);
    expect(s.tauxAcceptation).toBe(66.7);
  });

  it('refuse les transitions qui n’ont pas de sens', async () => {
    const [propose] = (await dansA((tx) => listerProspects(tx))).filter(
      (x) => x.statut === 'propose',
    );
    await expect(dansA((tx) => marquerConnecte(tx, propose!.id))).rejects.toBeInstanceOf(
      ProspectInvalide,
    );
    await expect(dansA((tx) => enregistrerMessage(tx, propose!.id))).rejects.toBeInstanceOf(
      ProspectInvalide,
    );
    await expect(dansA((tx) => marquerReponse(tx, propose!.id))).rejects.toBeInstanceOf(
      ProspectInvalide,
    );
    await expect(
      dansA((tx) => marquerDemandeEnvoyee(tx, '00000000-0000-4000-8000-000000000000')),
    ).rejects.toBeInstanceOf(ProspectInvalide);
  });

  it('refuse la demande suivante quand le quota du jour est atteint', async () => {
    await dansA((tx) => sauverReglages(tx, { quotaJour: 3 }));
    const [propose] = (await dansA((tx) => listerProspects(tx))).filter(
      (x) => x.statut === 'propose',
    );
    await expect(dansA((tx) => marquerDemandeEnvoyee(tx, propose!.id))).rejects.toBeInstanceOf(
      ActionRefusee,
    );
    expect(
      (await dansA((tx) => listerProspects(tx))).find((x) => x.id === propose!.id)?.statut,
    ).toBe('propose');
  });

  it('range sans réponse, écarte, et signale les demandes anciennes à retirer', async () => {
    await dansA((tx) => sauverReglages(tx, { quotaJour: 25 }));
    const liste = await dansA((tx) => listerProspects(tx));
    const envoye = liste.find((x) => x.statut === 'demande_envoyee')!;
    expect(envoye.aRetirer).toBe(false);
    const dans30jours = new Date(Date.now() + 30 * 24 * 3600_000);
    const plusTard = (await dansA((tx) => listerProspects(tx, dans30jours))).find(
      (x) => x.id === envoye.id,
    )!;
    expect(plusTard.aRetirer).toBe(true);
    await dansA((tx) => marquerSansReponse(tx, envoye.id));
    const [autre] = (await dansA((tx) => listerProspects(tx))).filter(
      (x) => x.statut === 'propose',
    );
    await dansA((tx) => ecarter(tx, autre!.id));
    const apres = await dansA((tx) => listerProspects(tx));
    expect(apres.find((x) => x.id === envoye.id)?.statut).toBe('sans_reponse');
    expect(apres.some((x) => x.id === autre!.id)).toBe(false);
  });

  it('garde chaque espace séparé', async () => {
    expect(await withInstance(t.app.db, b, (tx) => listerProspects(tx))).toEqual([]);
    expect(await withInstance(t.app.db, b, (tx) => disponiblesDansLaBase(tx))).toBe(0);
  });
});
