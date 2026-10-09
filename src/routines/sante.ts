import { desc, eq } from 'drizzle-orm';
import { connexions } from '../connexions/schema.js';
import type { Executor } from '../db.js';
import { currentInstance } from '../db/columns.js';
import { withInstance } from '../db/context.js';
import type { Instance } from '../instances/schema.js';
import { decaler, jourDe } from '../pilotage/realisees.js';
import { ROUTINES, resume, rythme } from './params.js';
import { heurePrevue } from './planification.js';
import { postes } from './schema.js';
import { dernieresExecutions, listerRoutines } from './service.js';

// A runner polls every 30 s: beyond two minutes without news, it is considered stopped.
const PRESENCE_MS = 2 * 60_000;
const FUSEAU = 'Europe/Paris';

export type Etat = 'ok' | 'attention' | 'manque';
export type Controle = { id: string; libelle: string; etat: Etat; detail: string; action?: string };

const NOM_CONNEXION = { messagerie: 'Messagerie', agenda: 'Agenda' } as const;
const FOURNISSEUR = { messagerie: 'gmail', agenda: 'google-agenda' } as const;

const depuis = (date: Date, maintenant: Date) => {
  const min = Math.round((maintenant.getTime() - date.getTime()) / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} jours`;
};

// Next scheduled run within a week, if the routine is clock-driven.
function prochaine(
  cle: (typeof ROUTINES)[number]['cle'],
  params: Record<string, unknown>,
  maintenant: Date,
) {
  const jour = jourDe(maintenant, FUSEAU);
  for (let k = 0; k < 8; k += 1) {
    const at = heurePrevue(cle, params, decaler(jour, k));
    if (at && at > maintenant) return at;
  }
  return null;
}

// What each routine needs to run, checked one by one: runner, Claude Code, skill, connections.
export async function santeRoutines(db: Executor, instance: Instance, maintenant = new Date()) {
  const [poste] = await db.select().from(postes).orderBy(desc(postes.vuLe)).limit(1);
  const enVie = !!poste && maintenant.getTime() - poste.vuLe.getTime() < PRESENCE_MS;

  return withInstance(db, instance.id, async (tx) => {
    const routines = await listerRoutines(tx);
    const dernieres = await dernieresExecutions(tx);
    const conn = await tx
      .select({ kind: connexions.kind, fournisseur: connexions.fournisseur, etat: connexions.etat })
      .from(connexions)
      .where(eq(connexions.instanceId, currentInstance));
    const branchee = (kind: 'messagerie' | 'agenda') => {
      const c = conn.find((x) => x.kind === kind);
      if (!c || c.etat === 'non_configuree') return false;
      if (c.fournisseur === 'fake') return instance.type === 'prospect';
      return c.fournisseur === FOURNISSEUR[kind] && c.etat !== 'erreur';
    };

    const executeur: Controle =
      poste && enVie
        ? {
            id: 'executeur',
            libelle: "L'exécuteur tourne sur l'ordinateur",
            etat: 'ok',
            detail: `${poste.nom}, dernier signe de vie il y a ${depuis(poste.vuLe, maintenant)}.`,
          }
        : {
            id: 'executeur',
            libelle: "L'exécuteur tourne sur l'ordinateur",
            etat: 'manque',
            detail: poste
              ? `Arrêté : aucun signe de vie depuis ${depuis(poste.vuLe, maintenant)} (${poste.nom}). Les routines sont demandées mais personne ne les lance.`
              : "Il n'a jamais tourné : les routines sont demandées mais personne ne les lance.",
            action: 'executeur',
          };
    const claude: Controle = poste?.claude
      ? { id: 'claude', libelle: 'Claude Code est installé', etat: 'ok', detail: poste.claude }
      : {
          id: 'claude',
          libelle: 'Claude Code est installé',
          etat: 'manque',
          detail: poste
            ? "L'exécuteur ne trouve pas la commande claude sur ce poste."
            : "Inconnu tant que l'exécuteur n'a pas tourné.",
          action: 'claude',
        };

    return {
      executeur: { actif: enVie, poste: poste?.nom ?? null, vuLe: poste?.vuLe ?? null },
      routines: routines.map((r) => {
        const def = ROUTINES.find((x) => x.cle === r.cle);
        const etapes = (def?.etapes ?? []).map((e) => ({
          texte: e.texte,
          besoin: e.besoin ?? null,
          bloquee: e.besoin ? !branchee(e.besoin) : false,
        }));
        const skill: Controle = poste?.skills.includes(r.skill)
          ? {
              id: 'skill',
              libelle: `La skill « ${r.skill} » existe`,
              etat: 'ok',
              detail: 'Trouvée dans ~/.claude/skills.',
            }
          : {
              id: 'skill',
              libelle: `La skill « ${r.skill} » existe`,
              etat: 'manque',
              detail: poste
                ? `Absente de ~/.claude/skills sur ${poste.nom} : Claude ne saura pas quoi faire.`
                : "Inconnu tant que l'exécuteur n'a pas tourné.",
              action: 'skill',
            };
        const besoins = [...new Set(etapes.flatMap((e) => (e.besoin ? [e.besoin] : [])))];
        const connexionsCtl: Controle[] = besoins.map((b) => {
          const premiere = etapes.find((e) => e.besoin === b);
          return branchee(b)
            ? {
                id: b,
                libelle: `${NOM_CONNEXION[b]} branchée`,
                etat: 'ok',
                detail: 'Connexion de cette instance.',
              }
            : {
                id: b,
                libelle: `${NOM_CONNEXION[b]} branchée`,
                etat: 'attention',
                detail: `Sans elle, la routine s'arrête à l'étape « ${premiere?.texte ?? ''} ».`,
                action: 'connexions',
              };
        });
        const quand = prochaine(r.cle, r.params, maintenant);
        const planif: Controle = !r.actif
          ? {
              id: 'actif',
              libelle: 'Routine active',
              etat: 'attention',
              detail: 'En pause : elle ne part ni à l’heure ni à la demande.',
              action: 'activer',
            }
          : {
              id: 'actif',
              libelle: 'Routine active',
              etat: 'ok',
              detail: quand
                ? `Prochaine exécution : ${quand.toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: FUSEAU })}.`
                : `${rythme(r.cle, r.params)}.`,
            };
        const controles = [executeur, claude, skill, ...connexionsCtl, planif];
        const feu: Etat = controles.some((c) => c.etat === 'manque')
          ? 'manque'
          : controles.some((c) => c.etat === 'attention')
            ? 'attention'
            : 'ok';
        return {
          cle: r.cle,
          nom: def?.nom ?? r.cle,
          skill: r.skill,
          actif: r.actif,
          resume: resume(r.cle, r.params),
          feu,
          controles,
          etapes,
          derniere: dernieres.find((d) => d.cle === r.cle)?.derniere ?? null,
        };
      }),
    };
  });
}

// Sign of life sent by the runner at each pass.
export async function signalerPoste(
  db: Executor,
  p: { nom: string; claude: string | null; skills: string[] },
  maintenant = new Date(),
) {
  await db
    .insert(postes)
    .values({ nom: p.nom, vuLe: maintenant, claude: p.claude, skills: p.skills })
    .onConflictDoUpdate({
      target: postes.nom,
      set: { vuLe: maintenant, claude: p.claude, skills: p.skills },
    });
}
