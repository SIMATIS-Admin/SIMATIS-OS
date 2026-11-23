import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { HsObject, HubspotClient } from './client.js';
import { texteBrut } from './mapping.js';

// Objets copiés en entier. Les mails ne sont lus que si le jeton en a le droit (sales-email-read).
const OBJETS = ['contacts', 'companies', 'deals', 'notes', 'calls', 'meetings', 'tasks'] as const;
const OPTIONNELS = ['emails'] as const;
const ASSOCIES = ['contacts', 'companies', 'deals'] as const;
const AVEC_LIENS = ['notes', 'calls', 'meetings', 'tasks', 'emails'] as const;

export type Archive = {
  slug: string;
  lueLe: string;
  objets: Record<string, HsObject[]>;
  // objet → identifiant → { contacts: [...], companies: [...], deals: [...] }
  liens: Record<string, Record<string, Record<string, string[]>>>;
  ignores: Record<string, string>;
};

// Toutes les propriétés de l'objet, pas seulement celles que la synchro lisait.
async function proprietes(client: HubspotClient, type: string): Promise<string[]> {
  const r = await client.request<{ results: { name: string }[] }>(
    'GET',
    `/crm/v3/properties/${type}`,
  );
  return r.results.map((p) => p.name);
}

// Copie intégrale (lecture seule) d'un CRM HubSpot : tous les enregistrements, toutes leurs
// propriétés, tous leurs liens. Sert de filet : rien de l'historique ne dépend de ce que l'OS affiche.
export async function lireTout(client: HubspotClient, slug: string): Promise<Archive> {
  const archive: Archive = {
    slug,
    lueLe: new Date().toISOString(),
    objets: {},
    liens: {},
    ignores: {},
  };
  for (const type of [...OBJETS, ...OPTIONNELS]) {
    try {
      archive.objets[type] = await client.listAll(type, await proprietes(client, type));
    } catch (error) {
      if (!(OPTIONNELS as readonly string[]).includes(type)) throw error;
      archive.ignores[type] = error instanceof Error ? error.message : String(error);
    }
  }
  for (const type of AVEC_LIENS) {
    const ids = (archive.objets[type] ?? []).map((o) => o.id);
    if (ids.length === 0) continue;
    const parObjet: Record<string, Record<string, string[]>> = {};
    for (const cible of ASSOCIES) {
      for (const [id, cibles] of await client.allAssociations(type, cible, ids)) {
        (parObjet[id] ??= {})[cible] = cibles;
      }
    }
    archive.liens[type] = parObjet;
  }
  return archive;
}

export async function ecrireArchive(archive: Archive, dossier: string): Promise<string> {
  await mkdir(dossier, { recursive: true });
  const fichier = path.join(
    dossier,
    `archive-hubspot-${archive.slug}-${archive.lueLe.replace(/[:.]/g, '-')}.json`,
  );
  await writeFile(fichier, JSON.stringify(archive));
  return fichier;
}

const LONGUEUR_MAX = 50_000;

// Le texte complet d'une activité pour l'historique de l'OS, sans la coupe à 2000 caractères de la
// synchro : corps de la note, de l'appel ou de la réunion, avec lieu et issue quand ils existent.
export function texteComplet(type: string, p: Record<string, string | null | undefined>) {
  const corps =
    type === 'notes'
      ? p.hs_note_body
      : type === 'calls'
        ? p.hs_call_body
        : type === 'meetings'
          ? p.hs_meeting_body
          : undefined;
  const parties = [texteBrut(corps, LONGUEUR_MAX)];
  if (type === 'meetings') {
    if (p.hs_meeting_location) parties.push(`Lieu : ${p.hs_meeting_location}`);
    if (p.hs_meeting_outcome) parties.push(`Issue : ${p.hs_meeting_outcome}`);
    parties.push(texteBrut(p.hs_internal_meeting_notes, LONGUEUR_MAX));
  }
  if (type === 'calls') {
    if (p.hs_call_duration)
      parties.push(`Durée : ${Math.round(Number(p.hs_call_duration) / 1000)} s`);
    if (p.hs_call_disposition) parties.push(`Résultat : ${p.hs_call_disposition}`);
  }
  const texte = parties.filter(Boolean).join('\n');
  return texte || null;
}
