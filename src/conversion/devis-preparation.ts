import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { entreprises, opportunites, rdvEntreprises, rendezVous } from '../crm/schema.js';
import { diagnosticProjets } from '../diagnostic/schema.js';
import type { Executor, Tx } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { DevisRefuse } from './devis-contenu.js';
import { devis, type Preparation } from './schema.js';

const texte = (max: number) => z.string().trim().max(max);
// Ce que Claude peut proposer : le périmètre, jamais un prix ni une condition.
export const propositionPerimetreSchema = z.object({
  contexte: texte(4000),
  objectifs: texte(4000),
  inclus: texte(4000),
  exclu: texte(4000),
});

const PAR_PASSAGE = 3;
const COMPTES_RENDUS = 5;
const EXTRAIT = 3000;

// Le pilote demande la préparation : l'exécuteur la reprend à son prochain passage. Seul un brouillon
// se prépare, et une demande en cours n'est pas doublée.
export async function demanderPreparation(db: Executor, instance: Instance, id: string) {
  return withInstance(db, instance.id, async (tx) => {
    const [d] = await tx
      .select({ statut: devis.statut, preparation: devis.preparation })
      .from(devis)
      .where(and(eq(devis.instanceId, currentInstance), eq(devis.id, id)));
    if (!d) throw new DevisRefuse('Devis introuvable');
    if (d.statut !== 'brouillon') throw new DevisRefuse('Seul un brouillon peut être préparé');
    if (d.preparation?.statut === 'demandee') return d.preparation;
    const preparation: Preparation = { statut: 'demandee', demandeLe: new Date().toISOString() };
    await tx.update(devis).set({ preparation }).where(eq(devis.id, id));
    return preparation;
  });
}

// La proposition est relue puis appliquée ou écartée dans l'éditeur : dans les deux cas elle s'efface.
export async function classerPreparation(db: Executor, instance: Instance, id: string) {
  return withInstance(db, instance.id, async (tx) => {
    await tx
      .update(devis)
      .set({ preparation: null })
      .where(and(eq(devis.instanceId, currentInstance), eq(devis.id, id)));
    return { ok: true };
  });
}

// Demandes en attente, avec ce que l'OS sait de l'affaire : de quoi proposer un périmètre.
export async function devisAPreparer(tx: Tx) {
  const rows = await tx
    .select({
      id: devis.id,
      titre: devis.titre,
      contexte: devis.contexte,
      inclus: devis.inclus,
      exclu: devis.exclu,
      objectifs: devis.objectifs,
      preparation: devis.preparation,
      opportuniteId: devis.opportuniteId,
      entrepriseId: opportunites.entrepriseId,
      entreprise: entreprises.nom,
    })
    .from(devis)
    .innerJoin(opportunites, eq(opportunites.id, devis.opportuniteId))
    .leftJoin(entreprises, eq(entreprises.id, opportunites.entrepriseId))
    .where(and(eq(devis.instanceId, currentInstance), eq(devis.statut, 'brouillon')))
    .limit(50);
  const attente = rows.filter((r) => r.preparation?.statut === 'demandee').slice(0, PAR_PASSAGE);
  const out = [];
  for (const r of attente) {
    const [projet] = await tx
      .select({ contexte: diagnosticProjets.contexte, proposition: diagnosticProjets.proposition })
      .from(diagnosticProjets)
      .where(
        and(
          eq(diagnosticProjets.instanceId, currentInstance),
          eq(diagnosticProjets.opportuniteId, r.opportuniteId),
        ),
      )
      .orderBy(desc(diagnosticProjets.updatedAt))
      .limit(1);
    let comptesRendus: string[] = [];
    if (r.entrepriseId) {
      const ids = (
        await tx
          .select({ id: rdvEntreprises.rendezVousId })
          .from(rdvEntreprises)
          .where(
            and(
              eq(rdvEntreprises.instanceId, currentInstance),
              eq(rdvEntreprises.entrepriseId, r.entrepriseId),
            ),
          )
      ).map((x) => x.id);
      if (ids.length > 0) {
        const rdvs = await tx
          .select({ titre: rendezVous.titre, compteRendu: rendezVous.compteRendu })
          .from(rendezVous)
          .where(and(eq(rendezVous.instanceId, currentInstance), inArray(rendezVous.id, ids)))
          .orderBy(desc(rendezVous.debut))
          .limit(20);
        comptesRendus = rdvs
          .filter((x) => (x.compteRendu ?? '').trim() !== '')
          .slice(0, COMPTES_RENDUS)
          .map((x) => `${x.titre} : ${(x.compteRendu ?? '').trim().slice(0, EXTRAIT)}`);
      }
    }
    out.push({
      id: r.id,
      titre: r.titre,
      entreprise: r.entreprise,
      actuel: { contexte: r.contexte, objectifs: r.objectifs, inclus: r.inclus, exclu: r.exclu },
      diagnosticContexte: projet?.contexte ?? '',
      formule: projet?.proposition?.formule ?? null,
      comptesRendus,
    });
  }
  return out;
}

// Rend la proposition de Claude, ou son échec. Sans demande en cours (déjà relue, ou devis validé
// entre-temps), le résultat est ignoré.
export async function poserPreparation(
  tx: Tx,
  id: string,
  resultat: { propose: z.infer<typeof propositionPerimetreSchema> } | { erreur: string },
): Promise<boolean> {
  const [d] = await tx
    .select({ preparation: devis.preparation })
    .from(devis)
    .where(and(eq(devis.instanceId, currentInstance), eq(devis.id, id)));
  if (d?.preparation?.statut !== 'demandee') return false;
  const preparation: Preparation =
    'propose' in resultat
      ? { ...d.preparation, statut: 'prete', propose: resultat.propose }
      : { ...d.preparation, statut: 'echec', erreur: resultat.erreur.slice(0, 300) };
  await tx.update(devis).set({ preparation }).where(eq(devis.id, id));
  return true;
}
