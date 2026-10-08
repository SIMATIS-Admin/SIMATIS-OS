import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readBackupStatus } from './backup-status.js';

describe('readBackupStatus', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'simatis-backup-'));
    await writeFile(
      path.join(dir, 'ok.json'),
      JSON.stringify({
        lastBackupAt: '2026-10-08T03:00:00Z',
        lastRestoreTestAt: '2026-10-05T03:10:00Z',
        ok: true,
        lastError: null,
      }),
    );
    await writeFile(path.join(dir, 'corrupt.json'), '{ "lastBackupAt": ');
    await writeFile(
      path.join(dir, 'failed.json'),
      JSON.stringify({
        lastBackupAt: '2026-10-07T03:00:00Z',
        lastRestoreTestAt: null,
        ok: false,
        lastError: 'Sauvegarde échouée : pg_dump',
      }),
    );
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns nulls when no backup has run yet', async () => {
    await expect(readBackupStatus(path.join(dir, 'absent.json'))).resolves.toEqual({
      lastBackupAt: null,
      lastRestoreTestAt: null,
      backupOk: null,
      backupError: null,
    });
  });

  it('reads the status written by the backup container', async () => {
    await expect(readBackupStatus(path.join(dir, 'ok.json'))).resolves.toEqual({
      lastBackupAt: '2026-10-08T03:00:00Z',
      lastRestoreTestAt: '2026-10-05T03:10:00Z',
      backupOk: true,
      backupError: null,
    });
  });

  it('reports the last error of a failed run', async () => {
    await expect(readBackupStatus(path.join(dir, 'failed.json'))).resolves.toMatchObject({
      lastBackupAt: '2026-10-07T03:00:00Z',
      backupOk: false,
      backupError: 'Sauvegarde échouée : pg_dump',
    });
  });

  it('returns nulls instead of throwing on a corrupt file', async () => {
    await expect(readBackupStatus(path.join(dir, 'corrupt.json'))).resolves.toEqual({
      lastBackupAt: null,
      lastRestoreTestAt: null,
      backupOk: null,
      backupError: null,
    });
  });
});
