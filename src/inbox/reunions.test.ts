import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { contacts } from '../crm/schema.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import { deposerSujet } from './depot.js';
import {
  attribuerReunion,
  deposerReunion,
  enregistrerTranscript,
  ReunionInvalide,
  reunionsATranscrire,
  TRANSCRIPT_MAX,
  type DepotReunion,
} from './reunions.js';

const reunion = (wisprId: string, extra: Partial<DepotReunion> = {}): DepotReunion => ({
  wisprId,
  titre: 'Point fictif avec Dupont Fictif',
  debutAt: new Date('2026-10-28T09:00:00Z'),
  participants: ['dupont.fictif@exemple.fr'],
  resume: 'Résumé fictif de la réunion.',
  ...extra,
});

describe('Inbox : réunions Wispr Flow', () => {
  let t: TestApp;
  let a: Instance;
  let b: Instance;

  beforeAll(async () => {
    t = await setupTestApp();
    a = await createInstance(t.owner.db, { slug: 'reu-a', nom: 'A', type: 'mandat' });
    b = await createInstance(t.owner.db, { slug: 'reu-b', nom: 'B', type: 'mandat' });
  });

  afterAll(async () => {
    await t.drop();
  });

  const deposer = (inst: Instance, r: DepotReunion) =>
    withInstance(t.app.db, inst.id, (tx) => deposerReunion(tx, r));
  const sujetsDe = async (inst: Instance, cle: string) =>
    (
      await t.owner.pool.query<{ type: string; origine: string; titre: string }>(
        'select type, origine, titre from sujets where instance_id = $1 and source_id = $2',
        [inst.id, cle],
      )
    ).rows;
  const reunionDe = async (inst: Instance, wisprId: string) =>
    (
      await t.owner.pool.query<{ critique: boolean; transcript: string | null }>(
        'select critique, transcript from reunions_wispr where instance_id = $1 and wispr_id = $2',
        [inst.id, wisprId],
      )
    ).rows;

  it('crée une entrée compte_rendu d’origine wispr, clé = wisprId, et la réunion', async () => {
    const r = await deposer(a, reunion('w-1'));
    expect(r.statut).toBe('cree');
    expect(await sujetsDe(a, 'w-1')).toEqual([
      {
        type: 'compte_rendu',
        origine: 'wispr',
        titre: 'Compte rendu : Point fictif avec Dupont Fictif',
      },
    ]);
    expect(await reunionDe(a, 'w-1')).toEqual([{ critique: false, transcript: null }]);
  });

  it('relue : statut existant, une seule entrée, le choix de Marc reste intact', async () => {
    const premiere = await deposer(a, reunion('w-2'));
    await withInstance(t.app.db, a.id, (tx) =>
      attribuerReunion(tx, premiere.sujetId, {
        contactId: null,
        entrepriseId: null,
        critique: true,
      }),
    );
    const seconde = await deposer(a, reunion('w-2', { resume: 'Autre résumé' }));
    expect(seconde).toEqual({ statut: 'existant', sujetId: premiere.sujetId });
    expect(await sujetsDe(a, 'w-2')).toHaveLength(1);
    expect(await reunionDe(a, 'w-2')).toEqual([{ critique: true, transcript: null }]);
  });

  it('sujetExistantId : aucune nouvelle entrée, la réunion est reliée', async () => {
    const existant = await withInstance(t.app.db, a.id, (tx) =>
      deposerSujet(tx, {
        type: 'compte_rendu',
        titre: 'CR du RDV avec Dupont Fictif',
        origine: 'agenda',
        source: 'routine',
        sourceId: 'rdv-fictif-1',
      }),
    );
    const r = await deposer(a, reunion('w-3', { sujetExistantId: existant.id }));
    expect(r).toEqual({ statut: 'relie', sujetId: existant.id });
    expect(await sujetsDe(a, 'w-3')).toHaveLength(0);
    expect(await reunionDe(a, 'w-3')).toHaveLength(1);
  });

  it('sujetExistantId déjà traité : non relié, une nouvelle entrée est créée', async () => {
    const existant = await withInstance(t.app.db, a.id, (tx) =>
      deposerSujet(tx, {
        type: 'compte_rendu',
        titre: 'CR traité',
        origine: 'agenda',
        source: 'routine',
        sourceId: 'rdv-fictif-2',
      }),
    );
    await t.owner.pool.query("update sujets set statut = 'traite' where id = $1", [existant.id]);
    const r = await deposer(a, reunion('w-4', { sujetExistantId: existant.id }));
    expect(r.statut).toBe('cree');
    expect(r.sujetId).not.toBe(existant.id);
  });

  it('sans participant connu : entrée créée, ni contact ni entreprise', async () => {
    const r = await deposer(a, reunion('w-5', { participants: [] }));
    const { rows } = await t.owner.pool.query(
      'select contact_id, entreprise_id from sujets where id = $1',
      [r.sujetId],
    );
    expect(rows).toEqual([{ contact_id: null, entreprise_id: null }]);
  });

  it('décocher critique après stockage supprime le transcript', async () => {
    const r = await deposer(a, reunion('w-6'));
    const attribuer = (critique: boolean) =>
      withInstance(t.app.db, a.id, (tx) =>
        attribuerReunion(tx, r.sujetId, { contactId: null, entrepriseId: null, critique }),
      );
    await attribuer(true);
    expect(await withInstance(t.app.db, a.id, reunionsATranscrire)).toContainEqual({
      wisprId: 'w-6',
      sujetId: r.sujetId,
    });
    await withInstance(t.app.db, a.id, (tx) =>
      enregistrerTranscript(tx, 'w-6', 'Transcript fictif'),
    );
    expect(await reunionDe(a, 'w-6')).toEqual([
      { critique: true, transcript: 'Transcript fictif' },
    ]);
    expect(await withInstance(t.app.db, a.id, reunionsATranscrire)).not.toContainEqual(
      expect.objectContaining({ wisprId: 'w-6' }),
    );
    await attribuer(false);
    expect(await reunionDe(a, 'w-6')).toEqual([{ critique: false, transcript: null }]);
  });

  it('réunion non critique : transcript refusé et rien de stocké', async () => {
    await deposer(a, reunion('w-7'));
    await expect(
      withInstance(t.app.db, a.id, (tx) => enregistrerTranscript(tx, 'w-7', 'Transcript fictif')),
    ).rejects.toBeInstanceOf(ReunionInvalide);
    expect(await reunionDe(a, 'w-7')).toEqual([{ critique: false, transcript: null }]);
  });

  it('transcript au-delà de la limite : refusé', async () => {
    const r = await deposer(a, reunion('w-8'));
    await withInstance(t.app.db, a.id, (tx) =>
      attribuerReunion(tx, r.sujetId, { contactId: null, entrepriseId: null, critique: true }),
    );
    await expect(
      withInstance(t.app.db, a.id, (tx) =>
        enregistrerTranscript(tx, 'w-8', 'x'.repeat(TRANSCRIPT_MAX + 1)),
      ),
    ).rejects.toBeInstanceOf(ReunionInvalide);
  });

  it('contact d’une autre instance refusé ; même wisprId dans deux instances = deux entrées', async () => {
    const [contact] = await t.owner.db
      .insert(contacts)
      .values({ instanceId: b.id, nom: 'Contact fictif' })
      .returning({ id: contacts.id });
    const r = await deposer(a, reunion('w-9'));
    await expect(
      withInstance(t.app.db, a.id, (tx) =>
        attribuerReunion(tx, r.sujetId, {
          contactId: contact?.id ?? null,
          entrepriseId: null,
          critique: false,
        }),
      ),
    ).rejects.toBeInstanceOf(ReunionInvalide);
    const autre = await deposer(b, reunion('w-9'));
    expect(autre.statut).toBe('cree');
    expect(autre.sujetId).not.toBe(r.sujetId);
  });
});
