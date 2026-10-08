import { parseArgs } from 'node:util';
import type { Database } from '../db.js';
import { seedDemoIfEmpty } from '../demo/seed.js';
import type { InstanceType } from '../instances/schema.js';
import {
  archiveInstance,
  createInstance,
  listInstances,
  purgeInstance,
} from '../instances/service.js';

export const USAGE = `Commandes :
  instance:list
  instance:create --slug <slug> --nom "<nom>" --type propre|mandat|prospect
  instance:archive --slug <slug>
  instance:purge --slug <slug> --confirmer
  demo:seed`;

type Deps = { db: Database; out: (line: string) => void };

// Returns the process exit code. Runs on the owner connection.
export async function runCommand(argv: string[], { db, out }: Deps): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      slug: { type: 'string' },
      nom: { type: 'string' },
      type: { type: 'string' },
      confirmer: { type: 'boolean', default: false },
    },
  });
  const need = (name: 'slug' | 'nom' | 'type'): string => {
    const value = values[name];
    if (!value) throw new Error(`Option manquante : --${name}`);
    return value;
  };

  try {
    switch (positionals[0]) {
      case 'instance:list':
        for (const i of await listInstances(db, { includeArchived: true })) {
          out(`${i.slug.padEnd(20)} ${i.type.padEnd(9)} ${i.statut.padEnd(8)} ${i.nom}`);
        }
        return 0;
      case 'instance:create': {
        const created = await createInstance(db, {
          slug: need('slug'),
          nom: need('nom'),
          type: need('type') as InstanceType,
        });
        out(`Instance créée : ${created.slug} (${created.type})`);
        return 0;
      }
      case 'instance:archive':
        out(`Instance archivée : ${(await archiveInstance(db, need('slug'))).slug}`);
        return 0;
      case 'instance:purge':
        if (!values.confirmer) {
          out('Purge irréversible des données métier : relancer avec --confirmer.');
          return 1;
        }
        out(`Instance purgée et archivée : ${(await purgeInstance(db, need('slug'))).slug}`);
        return 0;
      case 'demo:seed':
        out(
          (await seedDemoIfEmpty(db))
            ? 'Instances fictives chargées.'
            : 'Base non vide : rien chargé.',
        );
        return 0;
      default:
        out(USAGE);
        return 1;
    }
  } catch (error) {
    out(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
