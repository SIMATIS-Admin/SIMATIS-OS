import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { parseReglages } from '../connecteurs/hubspot/reglages.js';
import { connexions } from '../connexions/schema.js';
import type { Executor } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import { instances } from '../instances/schema.js';
import { getInstanceBySlug } from '../instances/service.js';
import { logEvent } from '../journal/service.js';
import {
  activites,
  affaireContacts,
  affaireEntreprises,
  contactEchangesMail,
  contactEmails,
  contactEntreprises,
  contacts,
  entreprises,
  opportunites,
  taches,
} from './schema.js';

export class DetachementRefuse extends Error {}

// Les tables du CRM copiées de HubSpot : chacune porte `source` et `source_id`.
const TABLES = [
  ['entreprises', entreprises],
  ['contacts', contacts],
  ['opportunites', opportunites],
  ['taches', taches],
  ['activites', activites],
  ['affaire_contacts', affaireContacts],
  ['affaire_entreprises', affaireEntreprises],
  ['contact_entreprises', contactEntreprises],
  ['contact_emails', contactEmails],
  ['contact_echanges_mail', contactEchangesMail],
] as const;

export type RapportDetachement = {
  slug: string;
  appliquer: boolean;
  lignes: Record<string, number>;
  etapes: number;
  // Fichier des correspondances table → identifiants HubSpot, écrit seulement en mode réel.
  sauvegarde: string | null;
};

// Détache une instance de HubSpot : ses fiches deviennent des fiches de l'OS (modifiables sans
// écrire dans HubSpot), ses étapes de pipeline passent dans sa configuration, la connexion CRM est
// supprimée. Rien n'est supprimé dans HubSpot ni dans l'OS ; les identifiants HubSpot sont gardés
// dans un fichier de sauvegarde. Sans `appliquer`, on ne fait que compter.
export async function detacherHubspot(
  db: Executor,
  slug: string,
  options: { appliquer: boolean; dossierSauvegarde: string },
): Promise<RapportDetachement> {
  const instance = await getInstanceBySlug(db, slug);
  if (!instance) throw new DetachementRefuse(`Instance inconnue : ${slug}`);
  return withInstance(db, instance.id, async (tx) => {
    const [crm] = await tx
      .select()
      .from(connexions)
      .where(and(eq(connexions.instanceId, currentInstance), eq(connexions.kind, 'crm')));
    if (crm?.fournisseur !== 'hubspot') {
      throw new DetachementRefuse('Cette instance n’a pas de CRM HubSpot branché.');
    }
    const reglages = parseReglages(crm.reglages);
    if (reglages.etapes.length === 0) {
      throw new DetachementRefuse(
        'Aucune étape de pipeline connue : lancez une synchro du CRM avant de détacher.',
      );
    }

    const lignes: Record<string, number> = {};
    const correspondances: Record<string, { id: string; sourceId: string | null }[]> = {};
    for (const [nom, table] of TABLES) {
      const rows = await tx
        .select({ id: table.id, sourceId: table.sourceId })
        .from(table)
        .where(and(eq(table.instanceId, instance.id), eq(table.source, 'hubspot')));
      lignes[nom] = rows.length;
      correspondances[nom] = rows;
    }
    const rapport: RapportDetachement = {
      slug,
      appliquer: options.appliquer,
      lignes,
      etapes: reglages.etapes.length,
      sauvegarde: null,
    };
    if (!options.appliquer) return rapport;

    // Les identifiants d'abord : si l'écriture du fichier échoue, rien n'est changé.
    const fichier = path.join(
      options.dossierSauvegarde,
      `detachement-hubspot-${slug}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
    );
    await mkdir(options.dossierSauvegarde, { recursive: true });
    await writeFile(fichier, JSON.stringify({ slug, etapes: reglages.etapes, correspondances }));
    rapport.sauvegarde = fichier;

    for (const [, table] of TABLES) {
      await tx
        .update(table)
        .set({ source: 'natif', sourceId: null, updatedAt: new Date() })
        .where(and(eq(table.instanceId, instance.id), eq(table.source, 'hubspot')));
    }
    await tx
      .update(instances)
      .set({
        config: {
          ...instance.config,
          pipeline: {
            etapes: reglages.etapes.map(({ id, label, ordre, clos, gagne, probabilite }) => ({
              id,
              label,
              ordre,
              clos,
              gagne,
              probabilite: probabilite ?? null,
            })),
          },
        },
        updatedAt: new Date(),
      })
      .where(eq(instances.id, instance.id));
    await tx.delete(connexions).where(eq(connexions.id, crm.id));
    await logEvent(tx, {
      acteur: 'pilote',
      action: `Instance détachée de HubSpot (${Object.values(lignes).reduce((a, b) => a + b, 0)} lignes passées dans l'OS)`,
      niveau: 'L2',
    });
    return rapport;
  });
}
