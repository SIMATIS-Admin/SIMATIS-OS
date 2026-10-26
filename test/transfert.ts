import type { TestApp } from './database.js';
import type { Instance } from '../src/instances/schema.js';
import { createInstance } from '../src/instances/service.js';

// Fictitious world for transfer tests: the own instance and two mandates.
export type Monde = { siege: Instance; a: Instance; b: Instance };

export async function creerMonde(t: TestApp): Promise<Monde> {
  const siege = await createInstance(t.owner.db, { slug: 'siege', nom: 'Siège', type: 'propre' });
  const a = await createInstance(t.owner.db, { slug: 'mandat-a', nom: 'Mandat A', type: 'mandat' });
  const b = await createInstance(t.owner.db, { slug: 'mandat-b', nom: 'Mandat B', type: 'mandat' });
  return { siege, a, b };
}

export function fabrique(t: TestApp) {
  const insere = async (i: Instance, table: string, colonnes: string, valeurs: unknown[]) =>
    (
      await t.owner.pool.query<{ id: string }>(
        `insert into ${table} (instance_id, ${colonnes}) values ($1, ${valeurs.map((_, n) => `$${n + 2}`).join(', ')}) returning id`,
        [i.id, ...valeurs],
      )
    ).rows[0]?.id as string;
  return {
    insere,
    contact: (i: Instance, nom: string, source = 'natif', sourceId: string | null = null) =>
      insere(i, 'contacts', 'nom, source, source_id', [nom, source, sourceId]),
    entreprise: (i: Instance, nom: string, source = 'natif', sourceId: string | null = null) =>
      insere(i, 'entreprises', 'nom, source, source_id', [nom, source, sourceId]),
    affaire: (i: Instance, titre: string, source = 'natif', sourceId: string | null = null) =>
      insere(i, 'opportunites', 'titre, etape, source, source_id', [
        titre,
        'qualification',
        source,
        sourceId,
      ]),
    tache: (
      i: Instance,
      titre: string,
      liens: { opportunite?: string; contact?: string; entreprise?: string } = {},
    ) =>
      insere(i, 'taches', 'titre, canal, opportunite_id, contact_id, entreprise_id', [
        titre,
        'tache',
        liens.opportunite ?? null,
        liens.contact ?? null,
        liens.entreprise ?? null,
      ]),
    sujet: (
      i: Instance,
      titre: string,
      opts: { contact?: string; sourceId?: string; source?: string } = {},
    ) =>
      insere(i, 'sujets', 'type, titre, origine, contact_id, source, source_id', [
        'autre',
        titre,
        'os',
        opts.contact ?? null,
        opts.source ?? 'natif',
        opts.sourceId ?? null,
      ]),
    rdv: (i: Instance, titre: string, source = 'natif') =>
      insere(i, 'rendez_vous', 'event_id, titre, source', [`ev-${titre}`, titre, source]),
    lierAffaireContact: (i: Instance, affaire: string, contact: string) =>
      insere(i, 'affaire_contacts', 'opportunite_id, contact_id', [affaire, contact]),
    lierRdvContact: (i: Instance, rdv: string, contact: string) =>
      insere(i, 'rdv_contacts', 'rendez_vous_id, contact_id', [rdv, contact]),
    activite: (i: Instance, opts: { contact?: string; affaire?: string; entreprise?: string }) =>
      insere(i, 'activites', 'type, titre, at, contact_id, opportunite_id, entreprise_id', [
        'note',
        'Note fictive',
        new Date().toISOString(),
        opts.contact ?? null,
        opts.affaire ?? null,
        opts.entreprise ?? null,
      ]),
    instanceDe: async (table: string, id: string) =>
      (
        await t.owner.pool.query<{ instance_id: string }>(
          `select instance_id from ${table} where id = $1`,
          [id],
        )
      ).rows[0]?.instance_id ?? null,
  };
}
