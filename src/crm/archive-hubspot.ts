import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { texteComplet, type Archive } from '../connecteurs/hubspot/archive.js';
import type { Executor } from '../db.js';
import { withInstance } from '../db/context.js';
import { getInstanceBySlug } from '../instances/service.js';
import { logEvent } from '../journal/service.js';
import { activites } from './schema.js';

const TYPES = ['notes', 'calls', 'meetings'] as const;

// Après `crm:detacher`, les activités n'ont plus d'identifiant HubSpot ; le fichier de détachement
// garde la correspondance. On prend le plus récent de l'instance.
async function dernierDetachement(dossier: string, slug: string) {
  const prefixe = `detachement-hubspot-${slug}-`;
  const fichiers = (await readdir(dossier)).filter((f) => f.startsWith(prefixe)).sort();
  const dernier = fichiers.at(-1);
  if (!dernier) return null;
  const contenu = JSON.parse(await readFile(path.join(dossier, dernier), 'utf8')) as {
    correspondances: { activites?: { id: string; sourceId: string | null }[] };
  };
  return contenu.correspondances.activites ?? [];
}

export type RapportEnrichissement = {
  activitesArchivees: number;
  retrouvees: number;
  absentesDeLOs: number;
  enrichies: number;
};

// Complète l'historique de l'OS avec le texte intégral des notes, appels et réunions de HubSpot
// (la synchro coupait à 2000 caractères et ignorait le corps des réunions). On n'écrase jamais un
// texte plus long déjà saisi dans l'OS.
export async function enrichirActivites(
  db: Executor,
  slug: string,
  archive: Archive,
  dossierDetachements: string,
  appliquer: boolean,
): Promise<RapportEnrichissement> {
  const instance = await getInstanceBySlug(db, slug);
  if (!instance) throw new Error(`Instance inconnue : ${slug}`);
  const correspondance = await dernierDetachement(dossierDetachements, slug);
  if (!correspondance) {
    throw new Error(
      'Aucun fichier de détachement : les activités ne peuvent pas être rapprochées.',
    );
  }
  const idOs = new Map(correspondance.filter((c) => c.sourceId).map((c) => [c.sourceId!, c.id]));
  const rapport: RapportEnrichissement = {
    activitesArchivees: 0,
    retrouvees: 0,
    absentesDeLOs: 0,
    enrichies: 0,
  };
  await withInstance(db, instance.id, async (tx) => {
    for (const type of TYPES) {
      for (const o of archive.objets[type] ?? []) {
        rapport.activitesArchivees += 1;
        const id = idOs.get(o.id);
        if (!id) {
          rapport.absentesDeLOs += 1;
          continue;
        }
        rapport.retrouvees += 1;
        const texte = texteComplet(type, o.properties);
        if (!texte) continue;
        const [actuelle] = await tx
          .select({ resume: activites.resume })
          .from(activites)
          .where(and(eq(activites.instanceId, instance.id), eq(activites.id, id)));
        if (!actuelle || (actuelle.resume ?? '').length >= texte.length) continue;
        rapport.enrichies += 1;
        if (appliquer) {
          await tx
            .update(activites)
            .set({ resume: texte, updatedAt: new Date() })
            .where(and(eq(activites.instanceId, instance.id), eq(activites.id, id)));
        }
      }
    }
    if (appliquer && rapport.enrichies > 0) {
      await logEvent(tx, {
        acteur: 'pilote',
        action: `Historique complété depuis l'archive HubSpot (${rapport.enrichies} activités)`,
        niveau: 'L2',
      });
    }
  });
  return rapport;
}
