import { and, eq } from 'drizzle-orm';
import { entreprises } from '../crm/schema.js';
import { currentInstance } from '../db/columns.js';
import { registerConnector } from './service.js';
import type { Connector } from './types.js';

// Fictive connector: for tests and for prospect (demo) instances. Settings:
// { entreprises: string[] } to mirror, { echouer: true } to fail after a first write.
export const fakeConnector: Connector = {
  fournisseur: 'fake',
  async sync({ tx, reglages }) {
    const noms = Array.isArray(reglages.entreprises) ? (reglages.entreprises as string[]) : [];
    let crees = 0;
    let maj = 0;
    for (const nom of noms) {
      const [existing] = await tx
        .select({ id: entreprises.id })
        .from(entreprises)
        .where(
          and(
            eq(entreprises.instanceId, currentInstance),
            eq(entreprises.source, 'fake'),
            eq(entreprises.sourceId, nom),
          ),
        );
      if (existing) {
        await tx
          .update(entreprises)
          .set({ nom, updatedAt: new Date() })
          .where(eq(entreprises.id, existing.id));
        maj += 1;
      } else {
        await tx.insert(entreprises).values({
          instanceId: currentInstance,
          source: 'fake',
          sourceId: nom,
          nom,
        });
        crees += 1;
      }
      if (reglages.echouer === true) throw new Error('Outil factice indisponible (429)');
    }
    return { lus: noms.length, crees, maj, erreurs: [] };
  },
  write(_ctx, op) {
    return Promise.resolve({ simulation: true, op: op.op });
  },
};

registerConnector(fakeConnector);
