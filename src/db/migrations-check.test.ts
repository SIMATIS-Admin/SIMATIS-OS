import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkMigrations, readMigrationsState, type MigrationsState } from './migrations-check.js';

const valid: MigrationsState = {
  sqlTags: ['0000_init', '0001_suite'],
  snapshotNumbers: ['0000', '0001'],
  journal: [
    { idx: 0, when: 100, tag: '0000_init' },
    { idx: 1, when: 200, tag: '0001_suite' },
  ],
};

describe('checkMigrations', () => {
  it('accepte un état cohérent', () => {
    expect(checkMigrations(valid)).toEqual([]);
  });

  it('refuse deux fichiers avec le même numéro', () => {
    const errors = checkMigrations({ ...valid, sqlTags: [...valid.sqlTags, '0001_autre'] });
    expect(errors.join('\n')).toContain('Numéro de migration 0001 en double');
  });

  it('refuse un fichier absent du journal', () => {
    const errors = checkMigrations({ ...valid, sqlTags: [...valid.sqlTags, '0002_oubli'] });
    expect(errors).toContain('0002_oubli absent du journal');
  });

  it('refuse une entrée du journal sans fichier ni snapshot', () => {
    const errors = checkMigrations({
      ...valid,
      journal: [...valid.journal, { idx: 2, when: 300, tag: '0002_fantome' }],
    });
    expect(errors).toContain('0002_fantome du journal sans fichier .sql');
    expect(errors).toContain('0002_fantome sans snapshot 0002_snapshot.json');
  });

  it('refuse un trou de numérotation et une date qui recule', () => {
    const errors = checkMigrations({
      sqlTags: ['0000_init', '0002_saut'],
      snapshotNumbers: ['0000', '0002'],
      journal: [
        { idx: 0, when: 100, tag: '0000_init' },
        { idx: 1, when: 50, tag: '0002_saut' },
      ],
    });
    expect(errors.join('\n')).toContain('le numéro ne suit pas la position 1');
    expect(errors.join('\n')).toContain('date antérieure');
  });
});

describe('migrations du dépôt', () => {
  it('sont cohérentes (numéros uniques, journal, snapshots)', () => {
    expect(checkMigrations(readMigrationsState(join(process.cwd(), 'drizzle')))).toEqual([]);
  });
});
