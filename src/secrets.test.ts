import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadInstanceSecrets } from './secrets.js';

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

  it('returns an empty object when the instance has no secrets file', async () => {
    await expect(loadInstanceSecrets(dir, 'aquaterra')).resolves.toEqual({});
  });

  it('reads the instance secrets file', async () => {
    await expect(loadInstanceSecrets(dir, 'helioval')).resolves.toEqual({
      HUBSPOT_TOKEN: 'pat-fictif-123',
    });
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
