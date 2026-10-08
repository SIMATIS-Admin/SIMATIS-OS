import { contacts, entreprises } from '../crm/schema.js';
import type { Database } from '../db.js';
import { instances, type InstanceType } from '../instances/schema.js';
import { createInstance } from '../instances/service.js';
import fixtures from './fixtures.json' with { type: 'json' };

// Loads the mockup's fictive instances, only into an empty database: real instances are never touched.
export async function seedDemoIfEmpty(db: Database): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: instances.id }).from(instances).limit(1);
    if (existing) return false;

    for (const f of fixtures) {
      const instance = await createInstance(tx, {
        slug: f.slug,
        nom: f.nom,
        type: f.type as InstanceType,
        config: f.config,
      });

      const ids = new Map<string, string>();
      for (const e of f.entreprises) {
        const [row] = await tx
          .insert(entreprises)
          .values({
            instanceId: instance.id,
            nom: e.nom,
            secteur: e.secteur,
            ville: e.ville,
            taille: e.taille,
            domaine: e.domaine,
          })
          .returning({ id: entreprises.id });
        if (row) ids.set(e.ref, row.id);
      }

      if (f.contacts.length > 0) {
        await tx.insert(contacts).values(
          f.contacts.map((c) => ({
            instanceId: instance.id,
            entrepriseId: ids.get(c.entreprise) ?? null,
            nom: c.nom,
            fonction: c.fonction,
            email: c.email,
            role: c.role,
          })),
        );
      }
    }
    return true;
  });
}
