import { getTableName } from 'drizzle-orm';
import { REGISTRE } from '../src/transfert/registre.js';
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
      opts: { contact?: string; sourceId?: string; source?: string; reporte?: boolean } = {},
    ) =>
      insere(i, 'sujets', 'type, titre, origine, contact_id, source, source_id, reporte_at', [
        'autre',
        titre,
        'os',
        opts.contact ?? null,
        // Real entries come from a routine, the OS or the site: never 'natif', never a mirror.
        opts.source ?? 'routine',
        opts.sourceId ?? null,
        opts.reporte ? new Date().toISOString() : null,
      ]),
    // A Google calendar block (mirror), or a block already detached from its event (`copie:`).
    rdv: (i: Instance, titre: string, detache = false) =>
      insere(i, 'rendez_vous', 'event_id, titre', [`${detache ? 'copie:' : 'ev-'}${titre}`, titre]),
    devis: (i: Instance, affaire: string, numero = 'D-1') =>
      insere(i, 'devis', 'opportunite_id, numero', [affaire, numero]),
    rdvLien: (i: Instance, contact: string, eventId = 'ev-lien') =>
      insere(i, 'rdv_liens', 'event_id, contact_id', [eventId, contact]),
    lierAffaireContact: (i: Instance, affaire: string, contact: string, source = 'natif') =>
      insere(i, 'affaire_contacts', 'opportunite_id, contact_id, source', [
        affaire,
        contact,
        source,
      ]),
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

// No row may point at a row of another instance, through ANY foreign key of the schema (not only
// the ones the registry knows): a new table that links to an object shows up here.
export async function liensCroises(t: TestApp): Promise<number> {
  const tables = Object.values(REGISTRE).map((e) => getTableName(e.table));
  const fk = await t.owner.pool.query<{ t: string; col: string; r: string }>(
    `select c.conrelid::regclass::text t, a.attname col, c.confrelid::regclass::text r
       from pg_constraint c
       join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.contype = 'f' and array_length(c.conkey, 1) = 1
        and c.confrelid::regclass::text = any($1)`,
    [tables],
  );
  let total = 0;
  for (const { t: table, col, r } of fk.rows) {
    const aInstance = await t.owner.pool.query(
      `select 1 from information_schema.columns where table_name = $1 and column_name = 'instance_id'`,
      [table],
    );
    if (!aInstance.rowCount) continue;
    const res = await t.owner.pool.query<{ n: string }>(
      `select count(*) n from ${table} a join ${r} b on a.${col} = b.id where a.instance_id <> b.instance_id`,
    );
    total += Number(res.rows[0]?.n);
  }
  return total;
}
