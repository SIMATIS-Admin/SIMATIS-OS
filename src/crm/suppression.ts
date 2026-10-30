import { and, eq, sql } from 'drizzle-orm';
import type { ConnexionDeps } from '../connexions/service.js';
import type { Executor, Tx } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { logEvent } from '../journal/service.js';
import { FicheInvalide, type Kind, type SimulationFiche } from './fiches.js';
import {
  ecrireHubspot,
  ligne,
  retirerFicheDesLiens,
  SIMULATION,
  viaHubspot,
  type Ref,
} from './liens.js';
import { contacts, entreprises, opportunites } from './schema.js';

// Every column that points to a record and is not a link table (those cascade). A deleted record is
// detached from these (column emptied); a merged one is replaced in them. `bloquant`: the owner
// cannot lose its record (not-null column), so deletion is refused while rows remain.
// The test of suppression.test.ts compares this list with the database foreign keys.
export const REFERENCES: {
  table: string;
  colonne: string;
  kind: Kind;
  bloquant?: { message: string };
}[] = [
  { table: 'taches', colonne: 'entreprise_id', kind: 'entreprise' },
  { table: 'taches', colonne: 'contact_id', kind: 'contact' },
  { table: 'taches', colonne: 'opportunite_id', kind: 'affaire' },
  { table: 'activites', colonne: 'entreprise_id', kind: 'entreprise' },
  { table: 'activites', colonne: 'contact_id', kind: 'contact' },
  { table: 'activites', colonne: 'opportunite_id', kind: 'affaire' },
  { table: 'contacts', colonne: 'entreprise_id', kind: 'entreprise' },
  { table: 'opportunites', colonne: 'entreprise_id', kind: 'entreprise' },
  { table: 'opportunites', colonne: 'contact_id', kind: 'contact' },
  { table: 'rdv_liens', colonne: 'entreprise_id', kind: 'entreprise' },
  { table: 'rdv_liens', colonne: 'contact_id', kind: 'contact' },
  { table: 'sujets', colonne: 'entreprise_id', kind: 'entreprise' },
  { table: 'sujets', colonne: 'contact_id', kind: 'contact' },
  { table: 'vma_tests', colonne: 'entreprise_id', kind: 'entreprise' },
  { table: 'prospection_occurrences', colonne: 'contact_id', kind: 'contact' },
  { table: 'prospection_brouillons', colonne: 'contact_id', kind: 'contact' },
  { table: 'diagnostic_projets', colonne: 'entreprise_id', kind: 'entreprise' },
  { table: 'diagnostic_projets', colonne: 'contact_id', kind: 'contact' },
  { table: 'diagnostic_projets', colonne: 'opportunite_id', kind: 'affaire' },
  {
    table: 'devis',
    colonne: 'opportunite_id',
    kind: 'affaire',
    bloquant: {
      message: 'Cette affaire a un devis : supprimez-le d’abord, ou fusionnez l’affaire.',
    },
  },
  {
    table: 'ateliers_strategie',
    colonne: 'entreprise_id',
    kind: 'entreprise',
    bloquant: {
      message:
        'Cette entreprise a un atelier stratégique : supprimez-le d’abord, ou fusionnez l’entreprise.',
    },
  },
];

const tables = { affaire: opportunites, contact: contacts, entreprise: entreprises } as const;

// Names come from the constant above, never from a request.
const colonne = (nom: string) => sql.raw(`"${nom}"`);

export async function supprimerLocalement(tx: Tx, ref: Ref): Promise<void> {
  for (const r of REFERENCES.filter((x) => x.kind === ref.kind && !x.bloquant)) {
    await tx.execute(
      sql`update ${colonne(r.table)} set ${colonne(r.colonne)} = null where ${colonne(r.colonne)} = ${ref.id} and instance_id = ${currentInstance}`,
    );
  }
  await retirerFicheDesLiens(tx, ref.kind, ref.id);
  const t = tables[ref.kind];
  await tx.delete(t).where(and(eq(t.instanceId, currentInstance), eq(t.id, ref.id)));
}

async function verifierSansBloquant(tx: Tx, ref: Ref) {
  for (const r of REFERENCES.filter((x) => x.kind === ref.kind && x.bloquant)) {
    const { rows } = await tx.execute<{ n: number }>(
      sql`select count(*)::int as n from ${colonne(r.table)} where ${colonne(r.colonne)} = ${ref.id} and instance_id = ${currentInstance}`,
    );
    if ((rows[0]?.n ?? 0) > 0) throw new FicheInvalide(r.bloquant!.message);
  }
}

export async function supprimerFiche(
  db: Executor,
  instance: Instance,
  ref: Ref,
  deps: ConnexionDeps,
): Promise<{ ok: true } | SimulationFiche> {
  return withInstance(db, instance.id, async (tx) => {
    const l = await ligne(tx, ref.kind, ref.id);
    if (!l) throw new FicheInvalide('Fiche introuvable dans cette instance');
    await verifierSansBloquant(tx, ref);
    if (await viaHubspot(tx, l, l)) {
      const simulation = await ecrireHubspot(
        tx,
        instance,
        'record.archive',
        { kind: ref.kind, id: ref.id },
        deps,
      );
      if (simulation) return SIMULATION;
    }
    await supprimerLocalement(tx, ref);
    await logEvent(tx, { acteur: 'pilote', action: `Fiche supprimée (${ref.kind})`, niveau: 'L2' });
    return { ok: true as const };
  });
}
