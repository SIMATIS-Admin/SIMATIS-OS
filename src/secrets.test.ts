import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GOOGLE_CLIENT_ID_APP } from './connecteurs/google/oauth.js';
import { loadInstanceSecrets, writeGoogleAppSecret } from './secrets.js';

describe('loadInstanceSecrets', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'simatis-secrets-'));
    await writeFile(path.join(dir, 'helioval.env'), 'HUBSPOT_TOKEN=pat-fictif-123\n# note\n');
    // A directory where a file is expected: unreadable as a secrets file.
    await mkdir(path.join(dir, 'casse.env'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns only the OS Google client ID when the instance has no secrets file', async () => {
    await expect(loadInstanceSecrets(dir, 'aquaterra')).resolves.toEqual({
      GOOGLE_CLIENT_ID: GOOGLE_CLIENT_ID_APP,
    });
  });

  it('reads the instance secrets file', async () => {
    await expect(loadInstanceSecrets(dir, 'helioval')).resolves.toEqual({
      HUBSPOT_TOKEN: 'pat-fictif-123',
      GOOGLE_CLIENT_ID: GOOGLE_CLIENT_ID_APP,
    });
  });

  it('adds the OS Google secret once saved, unless the instance has its own client', async () => {
    const own = await mkdtemp(path.join(tmpdir(), 'simatis-secrets-'));
    try {
      await writeGoogleAppSecret(own, 'GOCSPX-fictif');
      await writeFile(path.join(own, 'propre.env'), 'GOOGLE_CLIENT_ID=autre.apps.example\n');
      await expect(loadInstanceSecrets(own, 'aquaterra')).resolves.toEqual({
        GOOGLE_CLIENT_ID: GOOGLE_CLIENT_ID_APP,
        GOOGLE_CLIENT_SECRET: 'GOCSPX-fictif',
      });
      await expect(loadInstanceSecrets(own, 'propre')).resolves.toEqual({
        GOOGLE_CLIENT_ID: 'autre.apps.example',
      });
    } finally {
      await rm(own, { recursive: true, force: true });
    }
  });

  it('reports an unreadable file without leaking any value', async () => {
    const error = await loadInstanceSecrets(dir, 'casse').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/casse/);
    expect((error as Error).message).not.toMatch(/pat-fictif/);
  });

  it('rejects a slug that could escape the secrets directory', async () => {
    await expect(loadInstanceSecrets(dir, '../helioval')).rejects.toThrow(/invalide/);
  });
});
