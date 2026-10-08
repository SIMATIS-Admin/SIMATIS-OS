import { eq, sql } from 'drizzle-orm';
import type { Executor } from '../db.js';
import { logEvent } from '../journal/service.js';
import { autonomie } from './schema.js';

export type Niveau = 'L0' | 'L1' | 'L2' | 'L3';
export const NIVEAUX: Niveau[] = ['L0', 'L1', 'L2', 'L3'];

export type AutonomieDef = {
  action: string;
  libelle: string;
  defaut: Niveau | 'interdit';
  min: Niveau;
  max: Niveau;
  limite?: string;
};

const def = (
  action: string,
  libelle: string,
  defaut: Niveau | 'interdit',
  bounds: { min?: Niveau; max?: Niveau; limite?: string } = {},
): AutonomieDef => ({
  action,
  libelle,
  defaut,
  min: bounds.min ?? 'L0',
  max: bounds.max ?? 'L3',
  ...bounds,
});

// Defaults and locked limits from the mockup (data.js AUTONOMIE_DEFAUT, VIEWS.autonomie): an action
// with a fixed limit never goes above its default level, a send is always validated.
export const AUTONOMIE: AutonomieDef[] = [
  def('lire', 'Lire CRM, messagerie, agenda, bases', 'L3'),
  def('brouillon', "Créer un brouillon d'email", 'L1'),
  def('envoi', 'Envoyer un email', 'L2', {
    min: 'L2',
    max: 'L2',
    limite: 'Jamais L3 : un envoi se valide toujours.',
  }),
  def('journal', 'Écrire dans une base (journal en ajout seul, statuts)', 'L3'),
  def('modif', "Modifier des valeurs existantes d'une base", 'L2'),
  def('masse', 'Modification de masse', 'L2', {
    max: 'L2',
    limite: 'Toujours avec simulation et instantané.',
  }),
  def('tache', 'Créer ou modifier une tâche CRM', 'L2'),
  def('cloture', 'Clôturer une tâche prouvée par un envoi réel', 'L3'),
  def('devis', 'Préparer un devis, fixer un prix ou une remise', 'L1', {
    max: 'L1',
    limite: 'Le prix est toujours fixé par le pilote.',
  }),
  def('transmettre', 'Transmettre un devis ou un engagement au client', 'L2', {
    max: 'L2',
    limite: 'Validation explicite obligatoire.',
  }),
  def('cerveau', 'Écrire dans le second cerveau', 'L2', {
    max: 'L2',
    limite: "Toujours en brouillon, jamais validé par l'OS.",
  }),
  def('suppr', 'Supprimer des données', 'interdit', { limite: 'Interdit : on archive.' }),
];

const rank = (n: Niveau) => NIVEAUX.indexOf(n);

export function autonomieDef(action: string): AutonomieDef {
  const found = AUTONOMIE.find((a) => a.action === action);
  if (!found) throw new Error(`Action inconnue : ${action}`);
  return found;
}

// Effective level for the instance of the context: its override, or the default.
export async function niveauAction(tx: Executor, action: string): Promise<Niveau | 'interdit'> {
  const d = autonomieDef(action);
  if (d.defaut === 'interdit') return 'interdit';
  const [row] = await tx
    .select({ niveau: autonomie.niveau })
    .from(autonomie)
    .where(eq(autonomie.action, action));
  return row?.niveau ?? d.defaut;
}

export async function setNiveau(
  tx: Executor,
  action: string,
  niveau: Niveau,
  par: string,
): Promise<void> {
  const d = autonomieDef(action);
  if (d.defaut === 'interdit') throw new Error(`${d.libelle} : action interdite, non réglable.`);
  if (rank(niveau) < rank(d.min) || rank(niveau) > rank(d.max)) {
    throw new Error(`${d.libelle} : niveau ${niveau} hors limites (${d.min} à ${d.max}).`);
  }
  const avant = await niveauAction(tx, action);
  await tx
    .insert(autonomie)
    .values({
      instanceId: sql`nullif(current_setting('app.instance_id', true), '')::uuid`,
      action,
      niveau,
    })
    .onConflictDoUpdate({
      target: [autonomie.instanceId, autonomie.action],
      set: { niveau, updatedAt: new Date() },
    });
  await logEvent(tx, {
    acteur: par,
    action: `Autonomie modifiée : ${d.libelle} (${avant} → ${niveau})`,
    niveau: 'L2',
  });
}
