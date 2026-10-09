import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { SLUG } from './instances/service.js';

const checkSlug = (slug: string) => {
  if (!SLUG.test(slug)) throw new Error(`Identifiant d'instance invalide : ${slug}`);
};

// Null when the file does not exist; other failures name the file, never its content.
async function readOptional(file: string, slug: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    throw new Error(`Secrets illisibles pour l'instance ${slug} (${code ?? 'erreur inconnue'})`, {
      cause: error,
    });
  }
}

export const googleTokenPath = (dir: string, slug: string) => {
  checkSlug(slug);
  return path.join(dir, `${slug}.google.json`);
};

// Reads secrets/instances/<slug>.env, plus the Google refresh token written by google:connect
// (<slug>.google.json) as GOOGLE_REFRESH_TOKEN. Error messages never contain a secret value.
export async function loadInstanceSecrets(
  dir: string,
  slug: string,
): Promise<Record<string, string>> {
  checkSlug(slug);
  const env = await readOptional(path.join(dir, `${slug}.env`), slug);
  const secrets = env ? (parseEnv(env) as Record<string, string>) : {};
  const google = await readOptional(googleTokenPath(dir, slug), slug);
  if (google) {
    const token = (JSON.parse(google) as { refresh_token?: string }).refresh_token;
    if (token) secrets.GOOGLE_REFRESH_TOKEN = token;
  }
  return secrets;
}

const SECRET_KEY = /^[A-Z][A-Z0-9_]{0,63}$/;
const SECRET_VALUE = /^[\x21-\x7e]{1,4096}$/;

// Sets one KEY=value line in secrets/instances/<slug>.env (created 0600 if missing), keeping the
// other lines. Values are single printable tokens: no spaces, quotes or line breaks.
export async function writeInstanceSecret(
  dir: string,
  slug: string,
  key: string,
  value: string,
): Promise<void> {
  checkSlug(slug);
  if (!SECRET_KEY.test(key)) throw new Error(`Nom de secret invalide : ${key}`);
  if (!SECRET_VALUE.test(value) || /["'`#\\]/.test(value)) {
    throw new Error(`Valeur invalide pour ${key}`);
  }
  const file = path.join(dir, `${slug}.env`);
  const lines = ((await readOptional(file, slug)) ?? '')
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.startsWith(`${key}=`));
  await mkdir(dir, { recursive: true });
  await writeFile(file, `${[...lines, `${key}=${value}`].join('\n')}\n`, { mode: 0o600 });
  await chmod(file, 0o600);
}

export async function writeGoogleToken(
  dir: string,
  slug: string,
  token: { refresh_token: string; scope: string },
): Promise<string> {
  const file = googleTokenPath(dir, slug);
  await writeFile(
    file,
    `${JSON.stringify({ ...token, obtenuLe: new Date().toISOString() }, null, 2)}\n`,
    {
      mode: 0o600,
    },
  );
  await chmod(file, 0o600);
  return file;
}
