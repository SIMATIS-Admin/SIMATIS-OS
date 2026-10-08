import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { SLUG } from './instances/service.js';

// Reads secrets/instances/<slug>.env. Error messages never contain a secret value.
export async function loadInstanceSecrets(
  dir: string,
  slug: string,
): Promise<Record<string, string>> {
  if (!SLUG.test(slug)) throw new Error(`Identifiant d'instance invalide : ${slug}`);
  let raw: string;
  try {
    raw = await readFile(path.join(dir, `${slug}.env`), 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return {};
    throw new Error(`Secrets illisibles pour l'instance ${slug} (${code ?? 'erreur inconnue'})`, {
      cause: error,
    });
  }
  return parseEnv(raw) as Record<string, string>;
}
