import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestApp } from '../../test/database.js';
import { appDatabaseUrl, ensureAppRole } from './roles.js';

describe('appDatabaseUrl', () => {
  it('swaps user and password, keeps host and database', () => {
    expect(appDatabaseUrl('postgres://owner:secret@db:5432/simatis', 'simatis_app', 'pw')).toBe(
      'postgres://simatis_app:pw@db:5432/simatis',
    );
  });
});

describe('ensureAppRole', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await setupTestApp();
  });

  afterAll(async () => {
    await t.drop();
  });

  it('creates a role that can connect but can neither bypass RLS nor act as superuser', async () => {
    const { rows } = await t.app.pool.query<{ super: boolean; bypass: boolean }>(
      'select rolsuper as super, rolbypassrls as bypass from pg_roles where rolname = current_user',
    );
    expect(rows[0]).toEqual({ super: false, bypass: false });
  });

  it('can run again without error (every start replays it)', async () => {
    const role = new URL(t.appUrl).username;
    const password = new URL(t.appUrl).password;
    await expect(ensureAppRole(t.owner.pool, { role, password })).resolves.toBeUndefined();
    await expect(t.app.pool.query('select 1')).resolves.toBeDefined();
  });

  it('rejects a role name that is not a plain identifier', async () => {
    await expect(
      ensureAppRole(t.owner.pool, { role: 'x; drop table instances', password: 'p' }),
    ).rejects.toThrow(/rôle invalide/);
  });
});
