import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { contacts } from '../crm/schema.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { decide, propose } from '../propositions/service.js';
import './types-rdv.js';

// La routine propose un rendez-vous ; il n'existe dans l'OS qu'une fois validé par le pilote.
describe('Proposition : créer un rendez-vous', () => {
  let t: TestApp;
  let inst: Instance;
  const ctx = () => ({ instance: inst, realWrites: false, secretsDir: '/nonexistent' });
  const contenu = {
    titre: 'Point avec Alice',
    debut: '2026-11-17T09:00:00.000Z',
    dureeMinutes: 30,
    lieu: 'Visio',
  };
  const dans = <T>(f: Parameters<typeof withInstance<T>>[2]) =>
    withInstance(t.owner.db, inst.id, f);
  const rdvs = () =>
    t.owner.pool
      .query<{
        event_id: string;
        titre: string;
        statut: string;
        debut: Date;
        fin: Date;
        lieu: string;
      }>(
        'select event_id, titre, statut, debut, fin, lieu from rendez_vous where instance_id = $1',
        [inst.id],
      )
      .then((r) => r.rows);

  beforeAll(async () => {
    t = await setupTestApp();
    inst = await createInstance(t.owner.db, { slug: 'rdv-prop', nom: 'P', type: 'propre' });
  });
  afterAll(async () => {
    await t.drop();
  });

  it("n'écrit rien tant que le pilote n'a pas validé", async () => {
    const p = await dans((tx) =>
      propose(tx, ctx(), { type: 'rdv.creer', contenu, auteur: 'claude' }),
    );
    expect(p.statut).toBe('proposee');
    expect(await rdvs()).toEqual([]);
  });

  it('crée le rendez-vous os: avec son contact une fois validé', async () => {
    const [alice] = await dans((tx) =>
      tx.insert(contacts).values({ instanceId: inst.id, nom: 'Alice Fictive' }).returning(),
    );
    const p = await dans((tx) =>
      propose(tx, ctx(), {
        type: 'rdv.creer',
        contenu: { ...contenu, titre: 'Rendez-vous Alice', contactId: alice!.id },
        auteur: 'claude',
      }),
    );
    const decidee = await dans((tx) =>
      decide(tx, ctx(), p.id, { decision: 'valider', par: 'pilote' }),
    );
    expect(decidee.statut).toBe('appliquee');
    const lignes = (await rdvs()).filter((r) => r.titre === 'Rendez-vous Alice');
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ statut: 'rdv', lieu: 'Visio' });
    expect(lignes[0]!.event_id.startsWith('os:')).toBe(true);
    expect(lignes[0]!.fin.getTime() - lignes[0]!.debut.getTime()).toBe(30 * 60_000);
    const liens = await t.owner.pool.query(
      'select 1 from rdv_contacts rc join rendez_vous r on r.id = rc.rendez_vous_id where r.titre = $1 and rc.contact_id = $2',
      ['Rendez-vous Alice', alice!.id],
    );
    expect(liens.rowCount).toBe(1);
  });

  it('ne crée rien quand le pilote écarte la proposition', async () => {
    const avant = (await rdvs()).length;
    const p = await dans((tx) =>
      propose(tx, ctx(), {
        type: 'rdv.creer',
        contenu: { ...contenu, titre: 'Écarté' },
        auteur: 'claude',
      }),
    );
    await dans((tx) => decide(tx, ctx(), p.id, { decision: 'ecarter', par: 'pilote' }));
    expect(await rdvs()).toHaveLength(avant);
  });

  it('refuse une date absurde ou un contact absent de cet espace', async () => {
    await expect(
      dans((tx) =>
        propose(tx, ctx(), {
          type: 'rdv.creer',
          contenu: { ...contenu, debut: '1999-01-01T00:00:00.000Z' },
          auteur: 'claude',
        }),
      ),
    ).rejects.toThrow();
    const p = await dans((tx) =>
      propose(tx, ctx(), {
        type: 'rdv.creer',
        contenu: { ...contenu, titre: 'Contact inconnu', contactId: crypto.randomUUID() },
        auteur: 'claude',
      }),
    );
    const echec = await dans((tx) =>
      decide(tx, ctx(), p.id, { decision: 'valider', par: 'pilote' }),
    );
    expect(echec.statut).toBe('echec');
  });
});
