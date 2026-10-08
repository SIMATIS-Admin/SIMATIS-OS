import { readFile } from 'node:fs/promises';
import { z } from 'zod';

export type BackupStatus = {
  lastBackupAt: string | null;
  lastRestoreTestAt: string | null;
  backupOk: boolean | null;
  backupError: string | null;
};

const fileSchema = z.object({
  lastBackupAt: z.string().nullable(),
  lastRestoreTestAt: z.string().nullable(),
  ok: z.boolean(),
  lastError: z.string().nullable().optional(),
});

const UNKNOWN: BackupStatus = {
  lastBackupAt: null,
  lastRestoreTestAt: null,
  backupOk: null,
  backupError: null,
};

// Written by the backup container (backup/common.sh). Never throws: /health must always answer.
export async function readBackupStatus(file: string): Promise<BackupStatus> {
  try {
    const parsed = fileSchema.safeParse(JSON.parse(await readFile(file, 'utf8')));
    if (!parsed.success) return UNKNOWN;
    return {
      lastBackupAt: parsed.data.lastBackupAt,
      lastRestoreTestAt: parsed.data.lastRestoreTestAt,
      backupOk: parsed.data.ok,
      backupError: parsed.data.lastError ?? null,
    };
  } catch {
    return UNKNOWN;
  }
}
