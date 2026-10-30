import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { contacts, taches } from '../crm/schema.js';
import { withInstance } from '../db/context.js';
import { createInstance } from '../instances/service.js';
import { creerCampagneRelance, lireCampagne, reglageParDefaut } from './campagnes.js';
import {
  abandonnerCampagnes,
  attribuerCreneaux,
  campagnesEnAttente,
  demarrerCampagne,
  deposerBrouillons,
  finirCampagne,
  nettoyerCorps,
  relancerCampagne,
} from './redaction.js';
import { prospectionCampagnes } from './schema.js';

describe('nettoyerCorps', () => {
  it('retire les scripts, styles, gestionnaires et liens dangereux', () => {
    const sale =
      '<p onclick="x()">Bonjour</p><script>alert(1)</script><style>p{}</style><a href="javascript:alert(1)">lien</a><iframe src="x"></iframe>';
    const propre = nettoyerCorps(sale);
    expect(propre).not.toMatch(/script|style|onclick|javascript:|iframe/i);
    expect(propre).toContain('Bonjour');
    expect(propre).toContain('lien');
  });

  it('coupe toute signature après « -- » mais garde « Bien à vous, »', () => {
    const corps = '<p>Texte</p><p>Bien à vous,</p><p>--</p><p>Marc Tabouret<br>06 00 00 00 00</p>';
    const propre = nettoyerCorps(corps);
    expect(propre).toContain('Bien à vous,');
    expect(propre).not.toContain('Marc Tabouret');
  });

  it('garde les listes à puces des créneaux', () => {
    expect(nettoyerCorps('<ul><li>Jeudi 12 novembre à 9h30</li></ul>')).toContain('<li>');
  });
});

describe('attribuerCreneaux', () => {
  const pool = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
  it('donne 3 créneaux par mail, décalés d’un mail à l’autre', () => {
    const r = attribuerCreneaux(pool, 3);
    expect(r).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
      ['g', 'h', 'i'],
    ]);
  });
  it('recommence au début du lot quand il y a plus de mails que de créneaux', () => {
    expect(attribuerCreneaux(pool, 4)[3]).toEqual(['a', 'b', 'c']);
  });
  it('renvoie des listes vides sans créneau disponible', () => {
    expect(attribuerCreneaux([], 2)).toEqual([[], []]);
  });
  it('complète un lot de moins de 3 créneaux', () => {
    expect(attribuerCreneaux(['a', 'b'], 1)).toEqual([['a', 'b']]);
  });
});

describe('Rédaction d’une campagne par Claude', () => {
  let t: TestApp;
  let a: string;
  let b: string;

  beforeAll(async () => {
    t = await setupTestApp();
    a = (await createInstance(t.owner.db, { slug: 'red-a', nom: 'A', type: 'mandat' })).id;
    b = (await createInstance(t.owner.db, { slug: 'red-b', nom: 'B', type: 'mandat' })).id;
  });
  afterAll(async () => {
    await t.drop();
  });
  const dans = <T>(id: string, fn: Parameters<typeof withInstance<T>>[2]) =>
    withInstance(t.app.db, id, fn);

  async function nouvelle(instanceId: string, noms: string[]) {
    const ids: string[] = [];
    for (const nom of noms) {
      const [c] = await t.owner.db
        .insert(contacts)
        .values({ instanceId, nom, email: `${nom.toLowerCase()}@exemple.test` })
        .returning({ id: contacts.id });
      const [tc] = await t.owner.db
        .insert(taches)
        .values({ instanceId, titre: `Relancer ${nom}`, canal: 'email', contactId: c!.id })
        .returning({ id: taches.id });
      ids.push(tc!.id);
    }
    const r = await dans(instanceId, (tx) =>
      creerCampagneRelance(tx, { tacheIds: ids, reglage: reglageParDefaut() }),
    );
    return dans(instanceId, (tx) => lireCampagne(tx, r.campagneId));
  }

  it('propose la campagne en attente, la prend une seule fois', async () => {
    const c = await nouvelle(a, ['Alice', 'Bruno']);
    expect((await dans(a, (tx) => campagnesEnAttente(tx))).map((x) => x.id)).toContain(c.id);
    await dans(a, (tx) => demarrerCampagne(tx, c.id));
    expect((await dans(a, (tx) => campagnesEnAttente(tx))).map((x) => x.id)).not.toContain(c.id);
    await expect(dans(a, (tx) => demarrerCampagne(tx, c.id))).rejects.toThrow();
  });

  it('accepte les brouillons attendus, nettoyés, et passe en relecture quand tout est déposé', async () => {
    const c = await nouvelle(a, ['Carole', 'Denis']);
    await dans(a, (tx) => demarrerCampagne(tx, c.id));
    const [b1, b2] = c.brouillons;
    await dans(a, (tx) =>
      deposerBrouillons(tx, c.id, [
        {
          id: b1!.id,
          objet: 'Re: Échange',
          corps: '<p>Bonjour</p><script>x</script>',
          threadId: 't1',
        },
      ]),
    );
    expect((await dans(a, (tx) => lireCampagne(tx, c.id))).statut).toBe('redaction');
    await dans(a, (tx) =>
      deposerBrouillons(tx, c.id, [
        { id: b2!.id, objet: 'Re: Autre', corps: '<p>Bonjour</p>', aVerifier: 'Fil introuvable' },
      ]),
    );
    const apres = await dans(a, (tx) => lireCampagne(tx, c.id));
    expect(apres.statut).toBe('relecture');
    const un = apres.brouillons.find((x) => x.id === b1!.id)!;
    const deux = apres.brouillons.find((x) => x.id === b2!.id)!;
    expect(un).toMatchObject({ etat: 'pret', objet: 'Re: Échange', threadId: 't1' });
    expect(un.corps).not.toContain('script');
    expect(deux).toMatchObject({ etat: 'a_verifier', note: 'Fil introuvable' });
  });

  it('refuse un brouillon étranger à la campagne ou à une autre instance', async () => {
    const c = await nouvelle(a, ['Emma']);
    const autre = await nouvelle(b, ['Farid']);
    await dans(a, (tx) => demarrerCampagne(tx, c.id));
    await expect(
      dans(a, (tx) =>
        deposerBrouillons(tx, c.id, [
          { id: autre.brouillons[0]!.id, objet: 'x', corps: '<p>x</p>' },
        ]),
      ),
    ).rejects.toThrow(/inconnu|attendu/i);
    await expect(
      dans(a, (tx) =>
        deposerBrouillons(tx, c.id, [
          { id: '00000000-0000-4000-8000-000000000009', objet: 'x', corps: '<p>x</p>' },
        ]),
      ),
    ).rejects.toThrow(/inconnu|attendu/i);
  });

  it('un brouillon déposé deux fois est refusé', async () => {
    const c = await nouvelle(a, ['Gilles', 'Hélène']);
    await dans(a, (tx) => demarrerCampagne(tx, c.id));
    const id = c.brouillons[0]!.id;
    await dans(a, (tx) => deposerBrouillons(tx, c.id, [{ id, objet: 'x', corps: '<p>x</p>' }]));
    await expect(
      dans(a, (tx) => deposerBrouillons(tx, c.id, [{ id, objet: 'y', corps: '<p>y</p>' }])),
    ).rejects.toThrow();
  });

  it('en fin d’exécution, les brouillons manquants passent « à vérifier »', async () => {
    const c = await nouvelle(a, ['Irène', 'Jules']);
    await dans(a, (tx) => demarrerCampagne(tx, c.id));
    await dans(a, (tx) =>
      deposerBrouillons(tx, c.id, [{ id: c.brouillons[0]!.id, objet: 'x', corps: '<p>x</p>' }]),
    );
    await dans(a, (tx) => finirCampagne(tx, c.id));
    const apres = await dans(a, (tx) => lireCampagne(tx, c.id));
    expect(apres.statut).toBe('relecture');
    const manquant = apres.brouillons.find((x) => x.id === c.brouillons[1]!.id)!;
    expect(manquant.etat).toBe('a_verifier');
    expect(manquant.note).toMatch(/pas rédigé/i);
  });

  it('en fin d’exécution avec erreur, la campagne passe en erreur et relançable', async () => {
    const c = await nouvelle(a, ['Karim']);
    await dans(a, (tx) => demarrerCampagne(tx, c.id));
    await dans(a, (tx) => finirCampagne(tx, c.id, 'Claude s’est arrêté'));
    expect(await dans(a, (tx) => lireCampagne(tx, c.id))).toMatchObject({
      statut: 'erreur',
      erreur: 'Claude s’est arrêté',
    });
    await dans(a, (tx) => relancerCampagne(tx, c.id));
    const relance = await dans(a, (tx) => lireCampagne(tx, c.id));
    expect(relance).toMatchObject({ statut: 'redaction', erreur: null, demarreAt: null });
    expect(relance.brouillons.every((x) => x.etat === 'a_rediger')).toBe(true);
    expect((await dans(a, (tx) => campagnesEnAttente(tx))).map((x) => x.id)).toContain(c.id);
  });

  it('abandonne une campagne que l’exécuteur n’a pas prise en 15 minutes', async () => {
    const c = await nouvelle(a, ['Laure']);
    const ancien = new Date(Date.now() - 20 * 60_000);
    await t.owner.db.update(prospectionCampagnes).set({ demandeAt: ancien });
    const n = await dans(a, (tx) => abandonnerCampagnes(tx));
    expect(n).toBeGreaterThanOrEqual(1);
    const apres = await dans(a, (tx) => lireCampagne(tx, c.id));
    expect(apres.statut).toBe('erreur');
    expect(apres.erreur).toMatch(/exécuteur/i);
  });
});
