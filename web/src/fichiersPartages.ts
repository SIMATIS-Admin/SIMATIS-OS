import type { FichierPartage } from './cerveau.js';

// Fichiers non Markdown de l'espace partagé : de quoi les nommer, les ranger et les afficher.

const nomDe = (chemin: string) => chemin.split('/').at(-1) ?? chemin;
export const extension = (chemin: string) =>
  /\.([a-z0-9]+)$/i.exec(chemin)?.[1]?.toLowerCase() ?? '';

// Dossiers de l'espace partagé, écrits sans accent sur le kDrive.
const DOSSIERS: Record<string, string> = { reference: 'Référence' };

const humain = (brut: string) => {
  const texte = brut.replace(/[-_]+/g, ' ').trim();
  return texte.charAt(0).toUpperCase() + texte.slice(1);
};

export const nomFichier = nomDe;
export const nomLisible = (chemin: string) => humain(nomDe(chemin).replace(/\.[a-z0-9]+$/i, ''));
export const dossierLisible = (chemin: string) =>
  chemin
    .split('/')
    .slice(0, -1)
    .map((d) => DOSSIERS[d] ?? humain(d))
    .join(' › ') || 'Racine';

export const tailleLisible = (taille: string) => taille.replace('.', ',');

export function dateLisible(modifie: string) {
  const jour = /^\d{4}-\d{2}-\d{2}/.exec(modifie)?.[0];
  if (!jour) return modifie;
  return new Date(`${jour}T12:00:00Z`).toLocaleDateString('fr-FR', {
    timeZone: 'Europe/Paris',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

const MIMES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};
export const typeMime = (chemin: string) => MIMES[extension(chemin)] ?? 'application/octet-stream';

export type Famille = 'pdf' | 'image' | 'autre';
export const famille = (chemin: string): Famille => {
  const mime = typeMime(chemin);
  return mime === 'application/pdf' ? 'pdf' : mime.startsWith('image/') ? 'image' : 'autre';
};

export type Tri = 'dossier' | 'date';
export type Groupe = { titre: string; fichiers: FichierPartage[] };

export function grouper(fichiers: FichierPartage[], tri: Tri): Groupe[] {
  if (tri === 'date')
    return [
      {
        titre: 'Du plus récent au plus ancien',
        fichiers: [...fichiers].sort((a, b) => b.modifie.localeCompare(a.modifie)),
      },
    ];
  const groupes = new Map<string, FichierPartage[]>();
  for (const f of [...fichiers].sort((a, b) => a.chemin.localeCompare(b.chemin))) {
    const titre = dossierLisible(f.chemin);
    groupes.set(titre, [...(groupes.get(titre) ?? []), f]);
  }
  return [...groupes].map(([titre, liste]) => ({ titre, fichiers: liste }));
}
