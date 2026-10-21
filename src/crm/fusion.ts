import { and, eq, sql } from 'drizzle-orm';
import type { ConnexionDeps } from '../connexions/service.js';
import type { Executor } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { logEvent } from '../journal/service.js';
import { FicheInvalide, type Kind, type SimulationFiche } from './fiches.js';
import { ecrireHubspot, ligne, SIMULATION, transfererLiens, viaHubspot } from './liens.js';
import { contacts, entreprises, opportunites } from './schema.js';
import { REFERENCES, supprimerLocalement } from './suppression.js';

const tables = { affaire: opportunites, contact: contacts, entreprise: entreprises } as const;

// Fields of the absorbed record that fill the empty ones of the kept record; a filled field of the
// kept record is never overwritten.
const CHAMPS: Record<Kind, string[]> = {
  entreprise: ['secteur', 'ville', 'taille', 'domaine'],
  contact: ['fonction', 'email', 'telephone', 'role'],
  affaire: [
    'montant',
    'echeance',
    'motif',
    'proprietaire',
    'origine',
    'potentiel',
    'faisabilite',
    'prochaineEtape',
  ],
};

const vide = (v: unknown) => v === null || v === undefined || v === '';

export async function fusionnerFiches(
  db: Executor,
  instance: Instance,
  kind: Kind,
  gardeId: string,
  absorbeId: string,
  deps: ConnexionDeps,
): Promise<{ ok: true } | SimulationFiche> {
  if (gardeId === absorbeId) throw new FicheInvalide('Choisissez deux fiches différentes');
  return withInstance(db, instance.id, async (tx) => {
    const garde = await ligne(tx, kind, gardeId);
    const absorbe = await ligne(tx, kind, absorbeId);
    if (!garde || !absorbe) throw new FicheInvalide('Fiche introuvable dans cette instance');
    if (absorbe.source === 'hubspot' && garde.source !== 'hubspot')
      throw new FicheInvalide(
        'Gardez la fiche HubSpot : la fiche absorbée y existe et reviendrait à la prochaine synchronisation.',
      );
    if (await viaHubspot(tx, garde, absorbe)) {
      const simulation = await ecrireHubspot(
        tx,
        instance,
        'record.merge',
        { kind, gardeId, absorbeId },
        deps,
      );
      if (simulation) return SIMULATION;
    }

    const t = tables[kind];
    const [lg, la] = await Promise.all(
      [gardeId, absorbeId].map((id) =>
        tx
          .select()
          .from(t)
          .where(and(eq(t.instanceId, currentInstance), eq(t.id, id)))
          .then((rows) => rows[0] as Record<string, unknown>),
      ),
    );
    const complement = Object.fromEntries(
      CHAMPS[kind].filter((c) => vide(lg?.[c]) && !vide(la?.[c])).map((c) => [c, la?.[c]]),
    );
    if (Object.keys(complement).length > 0)
      await tx
        .update(t)
        .set({ ...complement, updatedAt: new Date() })
        .where(and(eq(t.instanceId, currentInstance), eq(t.id, gardeId)));

    for (const r of REFERENCES.filter((x) => x.kind === kind)) {
      await tx.execute(
        sql`update ${sql.raw(`"${r.table}"`)} set ${sql.raw(`"${r.colonne}"`)} = ${gardeId} where ${sql.raw(`"${r.colonne}"`)} = ${absorbeId} and instance_id = ${currentInstance}`,
      );
    }
    await transfererLiens(tx, kind, absorbeId, gardeId);
    await supprimerLocalement(tx, { kind, id: absorbeId });
    await logEvent(tx, { acteur: 'pilote', action: `Fiches fusionnées (${kind})`, niveau: 'L2' });
    return { ok: true as const };
  });
}
