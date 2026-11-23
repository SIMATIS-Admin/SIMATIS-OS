import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type JournalEntry = { idx: number; when: number; tag: string };

export type MigrationsState = {
  sqlTags: string[];
  snapshotNumbers: string[];
  journal: JournalEntry[];
};

// Deux branches parallèles créent facilement le même numéro de migration : le
// journal Drizzle ne le détecte pas et la base applique l'une ou l'autre selon
// l'ordre. On refuse tout état incohérent avant qu'il atteigne `main`.
export function checkMigrations(state: MigrationsState): string[] {
  const errors: string[] = [];
  const numberOf = (tag: string) => tag.slice(0, 4);

  const byNumber = new Map<string, string[]>();
  for (const tag of state.sqlTags) {
    byNumber.set(numberOf(tag), [...(byNumber.get(numberOf(tag)) ?? []), tag]);
  }
  for (const [number, tags] of byNumber) {
    if (tags.length > 1) {
      errors.push(`Numéro de migration ${number} en double : ${tags.join(', ')}`);
    }
  }

  const sql = new Set(state.sqlTags);
  const journalTags = new Set(state.journal.map((e) => e.tag));
  for (const tag of state.sqlTags) {
    if (!journalTags.has(tag)) errors.push(`${tag} absent du journal`);
  }
  for (const { tag } of state.journal) {
    if (!sql.has(tag)) errors.push(`${tag} du journal sans fichier .sql`);
    if (!state.snapshotNumbers.includes(numberOf(tag))) {
      errors.push(`${tag} sans snapshot ${numberOf(tag)}_snapshot.json`);
    }
  }

  let previousWhen = 0;
  state.journal.forEach((entry, position) => {
    if (entry.idx !== position) {
      errors.push(`${entry.tag} : idx ${entry.idx} au lieu de ${position}`);
    }
    if (numberOf(entry.tag) !== String(position).padStart(4, '0')) {
      errors.push(`${entry.tag} : le numéro ne suit pas la position ${position}`);
    }
    if (entry.when < previousWhen) {
      errors.push(`${entry.tag} : date antérieure à la migration précédente`);
    }
    previousWhen = entry.when;
  });

  return errors;
}

export function readMigrationsState(drizzleDir: string): MigrationsState {
  const journal = JSON.parse(readFileSync(join(drizzleDir, 'meta', '_journal.json'), 'utf8')) as {
    entries: JournalEntry[];
  };
  return {
    sqlTags: readdirSync(drizzleDir)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => f.slice(0, -4))
      .sort(),
    snapshotNumbers: readdirSync(join(drizzleDir, 'meta'))
      .filter((f) => f.endsWith('_snapshot.json'))
      .map((f) => f.slice(0, 4)),
    journal: journal.entries,
  };
}
