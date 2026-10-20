import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { writeVia, type ConnexionDeps } from '../connexions/service.js';
import type { Database } from '../db.js';
import { withInstance } from '../db/context.js';
import { deposerSujet } from '../inbox/depot.js';
import type { Instance } from '../instances/schema.js';
import { listInstances } from '../instances/service.js';
import { echeanceDe } from '../site/releve.js';
import { brouillonResultat, type EcranDirigeant } from './brouillon.js';
import { vmaTests } from './schema.js';

export type ReleveVmaDeps = {
  url: string;
  // Jeton de relève : même valeur que OS_PULL_TOKEN côté site (SITE_CONTACT_TOKEN dans le .env).
  token: string;
  fetch?: typeof fetch;
  // Écritures de la messagerie (brouillon du résultat) : absentes = pas de brouillon.
  ecriture?: ConnexionDeps;
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
          contactNom: vmaTests.contactNom,
          contactEmail: vmaTests.contactEmail,
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

// Contenu du sujet d'Inbox, et donc de la fiche rangée : tout ce qu'il faut pour le second cerveau.
// Le potentiel et les blocs sont là parce que la fiche est réservée à Marc.
export function resumeResultat(r: ResultatSite): string {
  const e = r.ecran as Record<string, unknown>;
  const c = r.calcul as {
    potentiel?: number;
    recurrent?: number;
    allureActuelle?: number;
    partRecurrent?: number | null;
    top?: { label: string; bloc: string }[];
  };
  const vma =
    typeof e.vma === 'number'
      ? `${euros(e.vma)} de CA commandé par mois (${String(e.statut)})`
      : 'non mesurable';
  const niveau = (e.niveau as { label?: string } | undefined)?.label ?? '';
  const freins = (c.top ?? []).map((f) => `${f.label} (bloc ${f.bloc})`).join(', ');
  return [
    `Entreprise : ${r.ecran.entreprise}`,
    `Type : ${r.type === 'essai' ? 'essai (non rangé, hors historique)' : 'premier test'}`,
    `Date du test : ${new Date(r.recueLe).toLocaleDateString('fr-FR')}`,
    `VMA : ${vma}`,
    c.recurrent && c.recurrent > 0 && `Socle récurrent : ${euros(c.recurrent)} par mois`,
    typeof c.allureActuelle === 'number' && `Allure actuelle : ${euros(c.allureActuelle)} par mois`,
    niveau && `Ambition : ${niveau}`,
    typeof c.potentiel === 'number' && `Potentiel brut : +${euros(c.potentiel)} par mois`,
    freins && `Freins les plus lourds : ${freins}`,
    `Version de la configuration : ${r.version}`,
  ]
    .filter(Boolean)
    .join('\n');
}

// Brouillon du résultat dans la messagerie de l'instance. Jamais envoyé, jamais bloquant : l'échec
// est noté dans le sujet, et le résultat reste rangé. Savepoint : une erreur ne casse pas la transaction.
async function brouillonDuResultat(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  instance: Instance,
  contact: { nom: string | null; email: string },
  r: ResultatSite,
  ecriture: ConnexionDeps,
): Promise<string> {
  const { subject, html } = brouillonResultat({
    contactNom: contact.nom,
    ecran: r.ecran as unknown as EcranDirigeant,
  });
  try {
    const res = await tx.transaction((sp) =>
      writeVia(
        sp,
        instance,
        'messagerie',
        { op: 'draft.create', data: { to: contact.email, subject, html } },
        ecriture,
      ),
    );
    return res.simulation
      ? 'Brouillon du résultat : simulé (écritures réelles désactivées).'
      : 'Brouillon du résultat créé dans la messagerie de l’instance.';
  } catch (error) {
    const raison = error instanceof Error ? error.message : String(error);
    return `Brouillon du résultat non créé : ${raison}`;
  }
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
      const instance = instances.find((i) => i.id === trouve.instanceId);
      if (!instance) continue;
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
        const note =
          deps.ecriture && trouve.contactEmail
            ? await brouillonDuResultat(
                tx,
                instance,
                { nom: trouve.contactNom, email: trouve.contactEmail },
                r,
                deps.ecriture,
              )
            : 'Aucun e-mail de contact : pas de brouillon.';
        await deposerSujet(tx, {
          type: 'autre',
          titre: `Test de VMA reçu : ${trouve.entrepriseNom}`,
          resume: `${resumeResultat(r)}\n${note}`,
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
