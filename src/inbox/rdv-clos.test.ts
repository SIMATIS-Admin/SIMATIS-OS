import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { rendezVous } from '../crm/schema.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import type { RendezVousPasse } from './lecture.js';
import { sansRendezVousClos } from './rdv-clos.js';

const rdv = (eventId: string): RendezVousPasse => ({
  eventId,
  titre: `Rendez-vous ${eventId}`,
  debut: '2026-10-28T08:00:00.000Z',
  fin: '2026-10-28T09:00:00.000Z',
  participants: ['paul@client.example'],
  lien: null,
  contactId: null,
  entrepriseId: null,
});

describe('Inbox : rendez-vous déjà clos dans l’OS', () => {
  let t: TestApp;
  let a: Instance;
  let b: Instance;

  const poser = (i: Instance, eventId: string, statut: string, compteRendu: string | null) =>
    t.owner.db.insert(rendezVous).values({
      instanceId: i.id,
      eventId,
      titre: `Rendez-vous ${eventId}`,
      statut,
      compteRendu,
    });

  beforeAll(async () => {
    t = await setupTestApp();
    a = await createInstance(t.owner.db, { slug: 'rdv-clos-a', nom: 'A', type: 'propre' });
    b = await createInstance(t.owner.db, { slug: 'rdv-clos-b', nom: 'B', type: 'mandat' });
    await poser(a, 'ecarte', 'ignore', null);
    await poser(a, 'documente', 'rdv', 'Compte rendu fictif');
    await poser(a, 'a-faire', 'rdv', null);
    await poser(a, 'a-trier', 'a_trier', null);
    // Écarté dans un autre espace seulement : il reste à traiter ici.
    await poser(b, 'ailleurs', 'ignore', null);
  });
  afterAll(async () => {
    await t.drop();
  });

  const filtrer = (i: Instance, ids: string[]) =>
    withInstance(t.app.db, i.id, (tx) => sansRendezVousClos(tx, ids.map(rdv))).then((l) =>
      l.map((r) => r.eventId),
    );

  it('retire un rendez-vous écarté de l’agenda dans l’OS', async () => {
    expect(await filtrer(a, ['ecarte', 'a-faire'])).toEqual(['a-faire']);
  });

  it('retire un rendez-vous dont le compte rendu est déjà enregistré', async () => {
    expect(await filtrer(a, ['documente', 'a-faire'])).toEqual(['a-faire']);
  });

  it('garde un rendez-vous sans compte rendu, trié ou non, et un inconnu de l’OS', async () => {
    expect(await filtrer(a, ['a-faire', 'a-trier', 'inconnu'])).toEqual([
      'a-faire',
      'a-trier',
      'inconnu',
    ]);
  });

  it('ne tient compte que de l’espace courant', async () => {
    expect(await filtrer(a, ['ailleurs'])).toEqual(['ailleurs']);
    expect(await filtrer(b, ['ailleurs'])).toEqual([]);
  });

  it('accepte une liste vide', async () => {
    expect(await filtrer(a, [])).toEqual([]);
  });
});
