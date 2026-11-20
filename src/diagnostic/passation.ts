import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { contacts, entreprises } from '../crm/schema.js';
import type { Database, Executor } from '../db.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { listInstances } from '../instances/service.js';
import { chargerGrille, cleQuestion, GrilleInvalide, type Grille } from './grille.js';
import { profilDe } from './profil.js';
import { diagnosticProjets } from './schema.js';
import { scorer, ScoreIncomplet, type ReponseQuestion } from './score.js';
import { ProjetIntrouvable, verifierEspace } from './service.js';

// Passation du diagnostic sur le site : l'OS prépare la fiche et ouvre la console, puis relève les
// réponses terminées. Le questionnaire et la grille restent hors de ce dépôt.
export class PassationImpossible extends Error {}

export type SiteDeps = { url: string; token: string; fetch?: typeof fetch };
export type FichePassation = {
  id: string;
  entreprise: string;
  interlocuteur: string;
  activite: string;
  taille: string;
  rdv: string;
  contexte: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const base = (url: string) => url.replace(/\/+$/, '');

// Tranches du questionnaire pour la taille (effectifs).
export function trancheEffectif(n: number | null): string {
  if (n == null) return '';
  if (n < 10) return 'moins de 10';
  if (n <= 50) return 'de 10 à 50';
  if (n <= 250) return 'de 50 à 250';
  if (n <= 5000) return 'de 250 à 5000';
  return 'Plus de 5000';
}

// Clé du site : « rubrique#numéro », celle de la grille. « E » (non applicable) devient « N/A ».
// Les questions hors grille ne passent pas : le calcul les refuserait, elles restent dans `passation`.
export function versReponsesEntretien(
  reponses: Record<string, string>,
  grille: Grille,
): ReponseQuestion[] {
  const out: ReponseQuestion[] = [];
  for (const q of grille.questions) {
    const lettre = reponses[cleQuestion(q)];
    if (!lettre) continue;
    out.push({
      section: q.section,
      numero: q.numero,
      reponse: lettre === 'E' ? 'N/A' : (lettre as 'A'),
    });
  }
  return out;
}

export async function preparerPassation(
  deps: SiteDeps,
  fiche: FichePassation,
): Promise<{ lien: string; expireLe: string }> {
  const res = await (deps.fetch ?? fetch)(`${base(deps.url)}/api/diagnostic/preparer`, {
    method: 'POST',
    headers: { authorization: `Bearer ${deps.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      projetId: fiche.id,
      entreprise: fiche.entreprise,
      interlocuteur: fiche.interlocuteur,
      activite: fiche.activite,
      taille: fiche.taille,
      rdv: fiche.rdv,
      contexte: fiche.contexte,
    }),
  });
  if (!res.ok) throw new PassationImpossible(`Site : préparation refusée (${res.status})`);
  const { lien, expireLe } = (await res.json()) as { lien: string; expireLe: string };
  return { lien, expireLe };
}

// Console seule, sans projet : le site rend un lien de session de 12 h vers « Mes diagnostics ».
export async function ouvrirConsole(deps: SiteDeps): Promise<{ lien: string; expireLe: string }> {
  const res = await (deps.fetch ?? fetch)(`${base(deps.url)}/api/diagnostic/preparer`, {
    method: 'POST',
    headers: { authorization: `Bearer ${deps.token}`, 'content-type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) throw new PassationImpossible(`Site : console refusée (${res.status})`);
  const { lien, expireLe } = (await res.json()) as { lien: string; expireLe: string };
  return { lien, expireLe };
}

// Fiche reprise du projet : rien à ressaisir sur le site.
export async function ouvrirPassation(
  db: Executor,
  instance: Instance,
  id: string,
  deps: SiteDeps,
): Promise<{ lien: string; expireLe: string }> {
  verifierEspace(instance);
  const fiche = await withInstance(db, instance.id, async (tx) => {
    const [p] = await tx
      .select()
      .from(diagnosticProjets)
      .where(and(eq(diagnosticProjets.id, id), eq(diagnosticProjets.instanceId, instance.id)));
    if (!p) throw new ProjetIntrouvable('Projet introuvable dans cette instance');
    const [e] = p.entrepriseId
      ? await tx.select().from(entreprises).where(eq(entreprises.id, p.entrepriseId))
      : [];
    const [c] = p.contactId
      ? await tx.select().from(contacts).where(eq(contacts.id, p.contactId))
      : [];
    return {
      id: p.id,
      entreprise: e?.nom ?? p.nom,
      interlocuteur: c?.nom ?? '',
      activite: p.activite,
      taille: trancheEffectif(e?.taille ?? null),
      rdv: p.dateDiagnostic
        ? new Date(`${p.dateDiagnostic}T12:00:00Z`).toLocaleDateString('fr-FR')
        : '',
      contexte: p.contexte,
    } satisfies FichePassation;
  });
  return preparerPassation(deps, fiche);
}

const diagSchema = z.object({
  id: z.string().min(8),
  // Diagnostic créé dans la console du site : l'OS en fait un projet à la relève.
  libre: z.boolean().optional(),
  entreprise: z.string().optional(),
  activite: z.string().optional(),
  contexte: z.string().optional(),
  reponses: z.record(z.string(), z.enum(['A', 'B', 'C', 'D', 'E'])),
  commentaires: z.record(z.string(), z.string()).default({}),
  tempsMs: z.number().min(0).default(0),
  termineLe: z.iso.datetime({ offset: true }),
});

// Un diagnostic créé dans la console n'a pas encore de projet : il prend l'identifiant du site.
async function creerProjetLibre(
  db: Database,
  instance: Instance,
  d: {
    id: string;
    entreprise?: string | undefined;
    activite?: string | undefined;
    contexte?: string | undefined;
  },
) {
  await withInstance(db, instance.id, async (tx) => {
    const [existe] = await tx
      .select({ id: diagnosticProjets.id })
      .from(diagnosticProjets)
      .where(eq(diagnosticProjets.id, d.id));
    if (existe) return;
    await tx.insert(diagnosticProjets).values({
      id: d.id,
      instanceId: instance.id,
      nom: (d.entreprise ?? '').trim() || 'Diagnostic sans nom',
      activite: (d.activite ?? '').trim() || 'autre',
      contexte: d.contexte ?? '',
    });
  });
}

export type ResultatPassations = { recus: number; enregistres: number; inconnus: number };

function grilleOuErreur(): Grille {
  const chemin = process.env.DIAGNOSTIC_GRILLE;
  if (!chemin)
    throw new PassationImpossible(
      'DIAGNOSTIC_GRILLE non défini : relève des passations suspendue.',
    );
  try {
    return chargerGrille(chemin);
  } catch (e) {
    if (e instanceof GrilleInvalide) throw new PassationImpossible(e.message);
    throw e;
  }
}

// Relève les diagnostics terminés. Un diagnostic n'est acquitté (donc effacé du site) qu'une fois enregistré :
// projet inconnu ou grille absente, il reste sur le site.
export async function releverPassations(db: Database, deps: SiteDeps): Promise<ResultatPassations> {
  const http = deps.fetch ?? fetch;
  const auth = { authorization: `Bearer ${deps.token}` };
  const res = await http(`${base(deps.url)}/api/diagnostic/en-attente`, { headers: auth });
  if (!res.ok) throw new PassationImpossible(`Site : lecture refusée (${res.status})`);
  const { diagnostics } = z.object({ diagnostics: z.array(z.unknown()) }).parse(await res.json());
  const compte: ResultatPassations = { recus: diagnostics.length, enregistres: 0, inconnus: 0 };
  if (diagnostics.length === 0) return compte;

  const grille = grilleOuErreur();
  const instances = (await listInstances(db)).filter((i) => i.type === 'propre');
  const items: { id: string; profil?: string }[] = [];

  for (const brut of diagnostics) {
    const parsed = diagSchema.safeParse(brut);
    if (!parsed.success) continue; // mal formé : laissé sur le site, rien n'est perdu
    const d = parsed.data;
    let trouve = false;
    // Identifiant qui n'est pas un UUID : aucun projet possible, le diagnostic reste sur le site.
    if (!UUID.test(d.id)) {
      compte.inconnus++;
      continue;
    }
    if (d.libre && UUID.test(d.id)) {
      const propre = instances[0];
      if (propre) await creerProjetLibre(db, propre, d);
    }
    for (const instance of instances) {
      const fait = await withInstance(db, instance.id, async (tx) => {
        const [p] = await tx
          .select()
          .from(diagnosticProjets)
          .where(
            and(eq(diagnosticProjets.id, d.id), eq(diagnosticProjets.instanceId, instance.id)),
          );
        if (!p) return null;
        if (p.passation?.recueLe === new Date(d.termineLe).toISOString())
          return { profil: p.dims ? profilDe(p.dims) : undefined, ecrit: false };
        const reponses = versReponsesEntretien(d.reponses, grille);
        let dims = p.dims;
        try {
          dims = scorer(reponses, grille).dims;
        } catch (e) {
          if (!(e instanceof ScoreIncomplet)) throw e;
        }
        await tx
          .update(diagnosticProjets)
          .set({
            passation: {
              recueLe: new Date(d.termineLe).toISOString(),
              tempsMs: Math.round(d.tempsMs),
              reponses: d.reponses,
              commentaires: d.commentaires,
            },
            reponsesEntretien: reponses,
            dims,
            historiqueReponses: [],
            updatedAt: new Date(),
          })
          .where(
            and(eq(diagnosticProjets.id, d.id), eq(diagnosticProjets.instanceId, instance.id)),
          );
        return { profil: dims ? profilDe(dims) : undefined, ecrit: true };
      });
      if (!fait) continue;
      trouve = true;
      if (fait.ecrit) compte.enregistres++;
      items.push({ id: d.id, ...(fait.profil ? { profil: fait.profil } : {}) });
      break;
    }
    if (!trouve) compte.inconnus++;
  }

  if (items.length > 0) {
    const ack = await http(`${base(deps.url)}/api/diagnostic/acquitter`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    if (!ack.ok) throw new PassationImpossible(`Site : acquittement refusé (${ack.status})`);
  }
  return compte;
}

export function startRelevePassations(
  db: Database,
  deps: SiteDeps & {
    tickMs?: number;
    onResult?: (r: ResultatPassations) => void;
    onError?: (error: unknown) => void;
  },
): () => void {
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    releverPassations(db, deps)
      .then((r) => deps.onResult?.(r))
      .catch((error: unknown) => deps.onError?.(error))
      .finally(() => {
        running = false;
      });
  };
  const timer = setInterval(tick, deps.tickMs ?? 60_000);
  tick();
  return () => clearInterval(timer);
}
