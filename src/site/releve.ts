import { z } from 'zod';
import type { Database } from '../db.js';
import { withInstance } from '../db/context.js';
import { deposerSujet } from '../inbox/depot.js';
import { listInstances } from '../instances/service.js';
import { logEvent } from '../journal/service.js';

// A request left on the public website's contact form, as the site's queue returns it.
const demandeSchema = z.object({
  id: z.uuid(),
  recueLe: z.iso.datetime({ offset: true }),
  objet: z.enum(['diagnostic', 'echange', 'autre']),
  nom: z.string().min(1).max(120),
  entreprise: z.string().min(1).max(160),
  email: z.email().max(200),
  fonction: z.string().max(120).nullish(),
  effectif: z.string().max(40).nullish(),
  telephone: z.string().max(40).nullish(),
  profil: z.string().max(40).nullish(),
  message: z.string().max(4000).nullish(),
});
export type DemandeSite = z.infer<typeof demandeSchema>;

export type ReleveDeps = {
  url: string;
  token: string;
  fetch?: typeof fetch;
};

export type ResultatReleve = { recues: number; creees: number; ignorees: number };

const LIBELLE: Record<DemandeSite['objet'], string> = {
  diagnostic: 'Demande de diagnostic',
  echange: "Demande d'échange",
  autre: 'Demande de contact',
};

// The answer is promised within 48 business hours on the site: the deadline follows.
export function echeanceDe(recueLe: Date): Date {
  const d = new Date(recueLe);
  let ouvres = 0;
  while (ouvres < 2) {
    d.setUTCDate(d.getUTCDate() + 1);
    const jour = d.getUTCDay();
    if (jour !== 0 && jour !== 6) ouvres++;
  }
  return d;
}

export function resumeDe(d: DemandeSite): string {
  return [
    `Contact : ${d.nom}${d.fonction ? `, ${d.fonction}` : ''}`,
    `Email : ${d.email}`,
    d.telephone && `Téléphone : ${d.telephone}`,
    d.effectif && `Effectif : ${d.effectif}`,
    d.profil && `Profil pressenti par le visiteur : ${d.profil}`,
    d.message && `Message :\n${d.message}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export class ReleveImpossible extends Error {}

// Pulls the website's pending requests into the Inbox of "Mon activité", then acknowledges them so
// the site deletes its copy. Acknowledged only after the commit: a crash in between re-delivers,
// and the stable key (`site`, request id) keeps it to one subject.
export async function releverDemandesSite(db: Database, deps: ReleveDeps): Promise<ResultatReleve> {
  const http = deps.fetch ?? fetch;
  const base = deps.url.replace(/\/+$/, '');
  const auth = { authorization: `Bearer ${deps.token}` };

  const res = await http(`${base}/api/contact/en-attente`, { headers: auth });
  if (!res.ok) throw new ReleveImpossible(`Site : lecture refusée (${res.status})`);
  const brut = z.object({ demandes: z.array(z.unknown()) }).parse(await res.json());
  if (brut.demandes.length === 0) return { recues: 0, creees: 0, ignorees: 0 };

  const propre = (await listInstances(db)).find((i) => i.type === 'propre');
  if (!propre) throw new ReleveImpossible('Aucune instance « Mon activité » active');

  const valides: DemandeSite[] = [];
  let ignorees = 0;
  for (const d of brut.demandes) {
    const parsed = demandeSchema.safeParse(d);
    if (parsed.success) valides.push(parsed.data);
    else ignorees++;
  }

  let creees = 0;
  await withInstance(db, propre.id, async (tx) => {
    for (const d of valides) {
      const { statut } = await deposerSujet(tx, {
        type: d.objet === 'diagnostic' ? 'diagnostic' : 'mail_a_repondre',
        titre: `${LIBELLE[d.objet]} — ${d.entreprise} (${d.nom})`,
        resume: resumeDe(d),
        origine: 'site',
        source: 'site',
        sourceId: d.id,
        echeance: echeanceDe(new Date(d.recueLe)),
      });
      if (statut === 'cree') creees++;
    }
    if (creees > 0) {
      await logEvent(tx, {
        acteur: 'site',
        action: 'site.demandes_relevees',
        details: { creees },
      });
    }
  });

  // Malformed requests are acknowledged too: kept on the site, they would block every pass.
  const ids = brut.demandes
    .map((d) => (d && typeof d === 'object' && 'id' in d ? String(d.id) : null))
    .filter((id): id is string => id !== null);
  const ack = await http(`${base}/api/contact/acquitter`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  if (!ack.ok) throw new ReleveImpossible(`Site : acquittement refusé (${ack.status})`);

  return { recues: brut.demandes.length, creees, ignorees };
}

export function startReleveSite(
  db: Database,
  deps: ReleveDeps & {
    tickMs?: number;
    onResult?: (r: ResultatReleve) => void;
    onError?: (error: unknown) => void;
  },
): () => void {
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    releverDemandesSite(db, deps)
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
