import { and, eq, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type { Database } from '../db.js';
import { withInstance } from '../db/context.js';
import { listInstances } from '../instances/service.js';
import { ReleveVmaImpossible, type ReleveVmaDeps } from './releve.js';
import { vmaTests } from './schema.js';

export type ResultatSuiviVma = { recus: number; rattaches: number };

const ligneSchema = z.object({
  invitation: z.string().regex(/^[0-9a-f]{32}$/),
  mailOuvertLe: z.iso.datetime({ offset: true }).nullable(),
  lienOuvertLe: z.iso.datetime({ offset: true }).nullable(),
});

// La date la plus ancienne l'emporte : LEAST ignore la valeur absente, et une réouverture ne déplace rien.
const plusTot = (colonne: PgColumn, date: string | null) =>
  date ? sql`least(${colonne}, ${date}::timestamptz)` : undefined;

// Relève les ouvertures du site (mail, lien) et les date sur l'invitation. Un site pas encore à jour
// (404) n'est pas une erreur. Acquittée après l'écriture : une ligne reçue deux fois ne change rien.
export async function releverSuiviVma(
  db: Database,
  deps: Pick<ReleveVmaDeps, 'url' | 'token' | 'fetch'>,
): Promise<ResultatSuiviVma> {
  const http = deps.fetch ?? fetch;
  const base = deps.url.replace(/\/+$/, '');
  const auth = { authorization: `Bearer ${deps.token}` };

  const res = await http(`${base}/api/test-vma/suivi`, { headers: auth });
  if (res.status === 404) return { recus: 0, rattaches: 0 };
  if (!res.ok) throw new ReleveVmaImpossible(`Site : lecture du suivi refusée (${res.status})`);
  const brut = z.object({ suivi: z.array(z.unknown()) }).parse(await res.json());

  const lignes = brut.suivi.flatMap((l) => {
    const parsed = ligneSchema.safeParse(l);
    return parsed.success ? [parsed.data] : [];
  });
  if (lignes.length === 0) return { recus: 0, rattaches: 0 };

  const instances = await listInstances(db);
  let rattaches = 0;
  for (const l of lignes) {
    for (const inst of instances) {
      const maj = await withInstance(db, inst.id, (tx) =>
        tx
          .update(vmaTests)
          .set({
            mailOuvertLe: plusTot(vmaTests.mailOuvertLe, l.mailOuvertLe),
            lienOuvertLe: plusTot(vmaTests.lienOuvertLe, l.lienOuvertLe),
            updatedAt: new Date(),
          })
          .where(and(eq(vmaTests.instanceId, inst.id), eq(vmaTests.invitationId, l.invitation)))
          .returning({ id: vmaTests.id }),
      );
      if (maj.length > 0) {
        rattaches++;
        break;
      }
    }
  }

  const ack = await http(`${base}/api/test-vma/suivi`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ ids: lignes.map((l) => l.invitation) }),
  });
  if (!ack.ok) throw new ReleveVmaImpossible(`Site : acquittement du suivi refusé (${ack.status})`);
  return { recus: lignes.length, rattaches };
}
