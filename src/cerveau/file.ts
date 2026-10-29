import { randomUUID } from 'node:crypto';
import { ajouterIdee, ecrireNote, ErreurCerveau, lireNote } from './fichiers.js';
import {
  ajouterDocumentPartage,
  deposerMessage,
  ecrirePartage,
  lirePartage,
  type AppelerPartage,
} from './partage.js';

// Le second cerveau est un dossier du poste de Marc : le serveur (dans Docker) ne peut pas le lire.
// Il met donc les demandes en file, et le runner du poste les exécute puis répond.

// Deux cerveaux : « simatis » (le dossier du Drive, par défaut) et « partage » (l'espace partagé
// AlpesIA × Simatis, sur kDrive).
export type Espace = 'simatis' | 'partage';

export type Operation =
  | { espace?: Espace; type: 'lire'; chemin: string }
  | { espace?: Espace; type: 'ecrire'; chemin: string; contenu: string; empreinte: string }
  | { espace?: Espace; type: 'ajouter'; titre: string; texte: string; concerne?: 'os' | undefined }
  | {
      espace: 'partage';
      type: 'message';
      genre: 'question' | 'reponse' | 'info';
      sujet: string;
      corps: string;
      enReponseA?: string | undefined;
    }
  | { espace: 'partage'; type: 'actualiser' };

export type Resultat =
  | {
      ok: true;
      chemin?: string;
      contenu?: string;
      empreinte?: string;
      lectureSeule?: string | null;
    }
  | { ok: false; erreur: string; conflit?: boolean };

export type Partage = { appeler: AppelerPartage; auteur: string };

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
export async function executer(
  dossier: string | null,
  op: Operation,
  partage: Partage | null = null,
): Promise<Resultat> {
  try {
    if (op.espace === 'partage') return await executerPartage(op, partage);
    if (!dossier)
      return {
        ok: false,
        erreur: "Le dossier du second cerveau n'est pas accessible sur ce poste.",
      };
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

async function executerPartage(op: Operation, partage: Partage | null): Promise<Resultat> {
  if (!partage)
    return {
      ok: false,
      erreur:
        "L'espace partagé n'est pas connecté sur ce poste : le serveur « partage » de Claude Code est introuvable.",
    };
  const { appeler, auteur } = partage;
  switch (op.type) {
    case 'lire':
      return { ok: true, chemin: op.chemin, ...(await lirePartage(appeler, op.chemin, auteur)) };
    case 'ecrire':
      return {
        ok: true,
        chemin: op.chemin,
        ...(await ecrirePartage(appeler, op.chemin, op.contenu, op.empreinte, auteur)),
      };
    case 'ajouter':
      return { ok: true, ...(await ajouterDocumentPartage(appeler, op, auteur)) };
    case 'message':
      return { ok: true, ...(await deposerMessage(appeler, op)) };
    case 'actualiser':
      return { ok: true };
  }
}
