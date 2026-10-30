import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import type { Message } from '../connecteurs/google/google.js';
import type { Messagerie } from '../connecteurs/messagerie.js';
import { contacts } from '../crm/schema.js';
import { withInstance } from '../db/context.js';
import { createInstance } from '../instances/service.js';
import { rapprocherEnvois } from './rapprochement.js';
import { prospectionOccurrences } from './schema.js';
import { statsProspection } from './stats.js';

const COMPTE = 'marc@exemple.test';

describe('Rapprochement des envois', () => {
  let t: TestApp;
  let id: string;

  beforeAll(async () => {
    t = await setupTestApp();
    id = (await createInstance(t.owner.db, { slug: 'rapp-a', nom: 'A', type: 'mandat' })).id;
  });
  afterAll(async () => {
    await t.drop();
  });

  const boite = (parContact: Record<string, Message[]>): Messagerie => ({
    historique: (email) => Promise.resolve(parContact[email] ?? []),
    filsRecents: () => Promise.resolve([]),
    brouillons: () => Promise.resolve([]),
    compte: () => Promise.resolve(COMPTE),
  });
  const message = (de: string, date: string): Message => ({
    id: `m-${date}`,
    date,
    de,
    a: null,
    objet: 'Re: x',
    extrait: '',
  });

  async function occurrence(nom: string, creeLe: Date, etat: 'brouillon' | 'envoye' = 'brouillon') {
    const email = `${nom.toLowerCase()}@client.test`;
    const [c] = await t.owner.db
      .insert(contacts)
      .values({ instanceId: id, nom, email })
      .returning({ id: contacts.id });
    const [o] = await t.owner.db
      .insert(prospectionOccurrences)
      .values({
        instanceId: id,
        mode: 'relance',
        contactId: c!.id,
        contactNom: nom,
        theme: 'Test de VMA',
        etat,
        createdAt: creeLe,
        ...(etat === 'envoye' ? { envoyeAt: creeLe } : {}),
      })
      .returning({ id: prospectionOccurrences.id });
    return { email, id: o!.id };
  }
  const etatDe = async (occ: string) => {
    const rows = await t.owner.db.select().from(prospectionOccurrences);
    return rows.find((r) => r.id === occ)!;
  };

  it('passe en « envoyé » le brouillon dont le mail est parti depuis sa création', async () => {
    const cree = new Date(Date.now() - 2 * 3600_000);
    const parti = await occurrence('Alice', cree);
    const attente = await occurrence('Bruno', cree);
    const envoye = new Date(Date.now() - 3600_000);
    const n = await withInstance(t.app.db, id, (tx) =>
      rapprocherEnvois(
        tx,
        boite({
          [parti.email]: [message(`Marc <${COMPTE}>`, envoye.toUTCString())],
          // Un mail du contact, ou un mail de Marc antérieur au brouillon, ne prouve rien.
          [attente.email]: [
            message(`Bruno <${attente.email}>`, envoye.toUTCString()),
            message(`Marc <${COMPTE}>`, new Date(cree.getTime() - 86400_000).toUTCString()),
          ],
        }),
      ),
    );
    expect(n).toBe(1);
    const apres = await etatDe(parti.id);
    expect(apres.etat).toBe('envoye');
    // Les en-têtes de date s'arrondissent à la seconde.
    expect(Math.abs((apres.envoyeAt?.getTime() ?? 0) - envoye.getTime())).toBeLessThan(1000);
    expect((await etatDe(attente.id)).etat).toBe('brouillon');
  });

  it('compte alors le mail dans le compteur du jour', async () => {
    const cree = new Date(Date.now() - 3 * 3600_000);
    const o = await occurrence('Carole', cree);
    const avant = (await withInstance(t.app.db, id, (tx) => statsProspection(tx))).jour;
    await withInstance(t.app.db, id, (tx) =>
      rapprocherEnvois(tx, boite({ [o.email]: [message(COMPTE, new Date().toUTCString())] })),
    );
    expect((await withInstance(t.app.db, id, (tx) => statsProspection(tx))).jour).toBe(avant + 1);
  });

  it('ignore les brouillons de plus de 21 jours et ceux déjà envoyés', async () => {
    const vieux = await occurrence('Denis', new Date(Date.now() - 30 * 86400_000));
    const deja = await occurrence('Emma', new Date(Date.now() - 3600_000), 'envoye');
    const b = boite({});
    let appels = 0;
    b.historique = (email) => {
      if (email === 'denis@client.test' || email === 'emma@client.test') appels += 1;
      return Promise.resolve([message(COMPTE, new Date().toUTCString())]);
    };
    await withInstance(t.app.db, id, (tx) => rapprocherEnvois(tx, b));
    expect((await etatDe(vieux.id)).etat).toBe('brouillon');
    expect((await etatDe(deja.id)).etat).toBe('envoye');
    expect(appels).toBe(0);
  });

  it('ne s’arrête pas quand la messagerie échoue pour un contact', async () => {
    const o = await occurrence('Farid', new Date(Date.now() - 3600_000));
    const b = boite({});
    b.historique = () => Promise.reject(new Error('Gmail indisponible'));
    const n = await withInstance(t.app.db, id, (tx) => rapprocherEnvois(tx, b));
    expect(n).toBe(0);
    expect((await etatDe(o.id)).etat).toBe('brouillon');
  });

  it('traite au plus 40 contacts par passage', async () => {
    for (let i = 0; i < 45; i += 1) await occurrence(`Lot${i}`, new Date(Date.now() - 3600_000));
    let appels = 0;
    const b = boite({});
    b.historique = () => {
      appels += 1;
      return Promise.resolve([]);
    };
    await withInstance(t.app.db, id, (tx) => rapprocherEnvois(tx, b));
    expect(appels).toBeLessThanOrEqual(40);
  });
});
