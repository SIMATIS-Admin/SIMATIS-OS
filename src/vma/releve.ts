import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db.js';
import { withInstance } from '../db/context.js';
import { deposerSujet } from '../inbox/depot.js';
import type { Instance } from '../instances/schema.js';
import { listInstances } from '../instances/service.js';
import { echeanceDe } from '../site/releve.js';
import { vmaTests } from './schema.js';

export type ReleveVmaDeps = {
  url: string;
  // Jeton de relève : même valeur que OS_PULL_TOKEN côté site (SITE_CONTACT_TOKEN dans le .env).
  token: string;
  fetch?: typeof fetch;
};

export type ResultatReleveVma = {
  recus: number;
  rattaches: number;
  aRattacher: number;
  ignores: number;
};

export class ReleveVmaImpossible extends Error {}

const hex32 = z.string().regex(/^[0-9a-f]{32}$/);

// Forme d'un résultat tel que le site le garde. Le calcul complet (gains, blocs) est gardé tel quel.
const resultatSchema = z.object({
  id: hex32,
  invitation: hex32,
  type: z.enum(['premier', 'essai']),
  recueLe: z.iso.datetime({ offset: true }),
  version: z.string().min(1),
  parametres: z.record(z.string(), z.unknown()),
  reponses: z.record(z.string(), z.unknown()),
  calcul: z.record(z.string(), z.unknown()),
  ecran: z.object({ entreprise: z.string().min(1) }).loose(),
});
type ResultatSite = z.infer<typeof resultatSchema>;

// Une invitation appartient à une seule instance : on la cherche dans chacune des instances actives.
async function trouverInvitation(db: Database, instances: Instance[], invitationId: string) {
  for (const inst of instances) {
    const [ligne] = await withInstance(db, inst.id, async (tx) =>
      tx
        .select({
          instanceId: vmaTests.instanceId,
          entrepriseId: vmaTests.entrepriseId,
          entrepriseNom: vmaTests.entrepriseNom,
          resultatId: vmaTests.resultatId,
        })
        .from(vmaTests)
        .where(and(eq(vmaTests.instanceId, inst.id), eq(vmaTests.invitationId, invitationId))),
    );
    if (ligne) return ligne;
  }
  return null;
}

const euros = (v: number) => `${Math.round(v).toLocaleString('fr-FR')}\u00a0€`;

export function resumeResultat(r: ResultatSite): string {
  const e = r.ecran as Record<string, unknown>;
  const vma =
    typeof e.vma === 'number'
      ? `${euros(e.vma)} de CA commandé par mois (${String(e.statut)})`
      : 'non mesurable';
  const niveau = (e.niveau as { label?: string } | undefined)?.label ?? '';
  return [
    `VMA : ${vma}`,
    niveau && `Ambition : ${niveau}`,
    `Version de la configuration : ${r.version}`,
  ]
    .filter(Boolean)
    .join('\n');
}

// Relève les résultats du site : chacun est rangé dans l'instance de son invitation, avec un sujet
// dans l'Inbox. Idempotente : un résultat déjà reçu ne crée rien. Acquittée après l'écriture.
export async function releverTestsVma(
  db: Database,
  deps: ReleveVmaDeps,
): Promise<ResultatReleveVma> {
  const http = deps.fetch ?? fetch;
  const base = deps.url.replace(/\/+$/, '');
  const auth = { authorization: `Bearer ${deps.token}` };

  const res = await http(`${base}/api/test-vma/en-attente`, { headers: auth });
  if (!res.ok) throw new ReleveVmaImpossible(`Site : lecture refusée (${res.status})`);
  const brut = z.object({ resultats: z.array(z.unknown()) }).parse(await res.json());
  if (brut.resultats.length === 0) return { recus: 0, rattaches: 0, aRattacher: 0, ignores: 0 };

  const instances = await listInstances(db);
  const propre = instances.find((i) => i.type === 'propre');
  if (!propre) throw new ReleveVmaImpossible('Aucune instance « Mon activité » active');

  const compte = { recus: brut.resultats.length, rattaches: 0, aRattacher: 0, ignores: 0 };
  const idsTraites: string[] = [];

  for (const brutRes of brut.resultats) {
    const parsed = resultatSchema.safeParse(brutRes);
    if (!parsed.success) {
      // Mal formé : acquitté quand même, sinon il bloquerait chaque relève.
      compte.ignores++;
      const id = (brutRes as { id?: unknown })?.id;
      if (typeof id === 'string' && hex32.safeParse(id).success) idsTraites.push(id);
      continue;
    }
    const r = parsed.data;
    idsTraites.push(r.id);

    const trouve = await trouverInvitation(db, instances, r.invitation);
    if (trouve) {
      if (trouve.resultatId === r.id) continue; // déjà reçu : rien à refaire
      await withInstance(db, trouve.instanceId, async (tx) => {
        await tx
          .update(vmaTests)
          .set({
            resultatId: r.id,
            recueLe: new Date(r.recueLe),
            version: r.version,
            parametres: r.parametres,
            reponses: r.reponses,
            calcul: r.calcul,
            ecran: r.ecran,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(vmaTests.instanceId, trouve.instanceId),
              eq(vmaTests.invitationId, r.invitation),
            ),
          );
        await deposerSujet(tx, {
          type: 'autre',
          titre: `Test de VMA reçu : ${trouve.entrepriseNom}`,
          resume: resumeResultat(r),
          origine: 'test-vma',
          source: 'site',
          sourceId: r.id,
          echeance: echeanceDe(new Date(r.recueLe)),
          entrepriseId: trouve.entrepriseId,
        });
      });
      compte.rattaches++;
    } else {
      // Invitation inconnue de l'OS (cas anormal) : un sujet à rattacher, rien d'autre n'est créé.
      await withInstance(db, propre.id, (tx) =>
        deposerSujet(tx, {
          type: 'autre',
          titre: 'Test de VMA à rattacher',
          resume: `Un résultat est arrivé avec une invitation inconnue de SIMATIS OS.\n${resumeResultat(r)}`,
          origine: 'test-vma',
          source: 'site',
          sourceId: r.id,
          echeance: echeanceDe(new Date(r.recueLe)),
        }),
      );
      compte.aRattacher++;
    }
  }

  const ack = await http(`${base}/api/test-vma/acquitter`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ ids: idsTraites }),
  });
  if (!ack.ok) throw new ReleveVmaImpossible(`Site : acquittement refusé (${ack.status})`);
  return compte;
}

export function startReleveVma(
  db: Database,
  deps: ReleveVmaDeps & {
    tickMs?: number;
    onResult?: (r: ResultatReleveVma) => void;
    onError?: (error: unknown) => void;
  },
): () => void {
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    releverTestsVma(db, deps)
      .then((r) => deps.onResult?.(r))
      .catch((error: unknown) => deps.onError?.(error))
      .finally(() => {
        running = false;
      });
  };
  const timer = setInterval(tick, deps.tickMs ?? 5 * 60_000);
  tick();
  return () => clearInterval(timer);
}
