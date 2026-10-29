import { randomUUID } from 'node:crypto';
import { ajouterIdee, ecrireNote, ErreurCerveau, lireNote } from './fichiers.js';

// Le second cerveau est un dossier du poste de Marc : le serveur (dans Docker) ne peut pas le lire.
// Il met donc les demandes en file, et le runner du poste les exécute puis répond.

export type Operation =
  | { type: 'lire'; chemin: string }
  | { type: 'ecrire'; chemin: string; contenu: string; empreinte: string }
  | { type: 'ajouter'; titre: string; texte: string };

export type Resultat =
  | { ok: true; chemin?: string; contenu?: string; empreinte?: string }
  | { ok: false; erreur: string; conflit?: boolean };

export class RunnerInjoignable extends Error {}

type Attente = {
  id: string;
  operation: Operation;
  prise: boolean;
  repondre: (r: Resultat) => void;
};
const attentes = new Map<string, Attente>();

export const DELAI_MS = 15_000;

// Demande une opération au runner et attend sa réponse.
export function demander(operation: Operation, delaiMs = DELAI_MS): Promise<Resultat> {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const minuteur = setTimeout(() => {
      attentes.delete(id);
      reject(new RunnerInjoignable());
    }, delaiMs);
    attentes.set(id, {
      id,
      operation,
      prise: false,
      repondre: (r) => {
        clearTimeout(minuteur);
        attentes.delete(id);
        resolve(r);
      },
    });
  });
}

// Opérations que le runner n'a pas encore prises ; chacune ne lui est remise qu'une fois.
export function prendre(): { id: string; operation: Operation }[] {
  const out = [];
  for (const a of attentes.values()) {
    if (a.prise) continue;
    a.prise = true;
    out.push({ id: a.id, operation: a.operation });
  }
  return out;
}

export function repondre(id: string, resultat: Resultat): boolean {
  const a = attentes.get(id);
  if (!a) return false;
  a.repondre(resultat);
  return true;
}

export const viderFile = () => attentes.clear();

// Exécution sur le poste : les refus attendus deviennent un résultat, le reste remonte.
export async function executer(dossier: string, op: Operation): Promise<Resultat> {
  try {
    switch (op.type) {
      case 'lire':
        return { ok: true, chemin: op.chemin, ...(await lireNote(dossier, op.chemin)) };
      case 'ecrire':
        return {
          ok: true,
          chemin: op.chemin,
          ...(await ecrireNote(dossier, op.chemin, op.contenu, op.empreinte)),
        };
      case 'ajouter':
        return { ok: true, ...(await ajouterIdee(dossier, op)) };
    }
  } catch (e) {
    if (e instanceof ErreurCerveau) return { ok: false, erreur: e.message, conflit: e.conflit };
    throw e;
  }
}
