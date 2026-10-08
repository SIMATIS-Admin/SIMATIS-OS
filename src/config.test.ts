import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const DATABASE_URL = 'postgres://simatis:secret@127.0.0.1:5433/simatis';
const BASE = { DATABASE_URL, APP_DB_PASSWORD: 'apppass' };

describe('loadConfig', () => {
  it('applies defaults when only the required variables are set', () => {
    expect(loadConfig(BASE)).toEqual({
      databaseUrl: DATABASE_URL,
      appDbRole: 'simatis_app',
      appDbPassword: 'apppass',
      host: '127.0.0.1',
      port: 3000,
      logLevel: 'info',
      secretsDir: './secrets/instances',
      realWrites: false,
    });
  });

  it('reads explicit values', () => {
    const config = loadConfig({
      ...BASE,
      HOST: '0.0.0.0',
      PORT: '4300',
      LOG_LEVEL: 'debug',
      APP_DB_ROLE: 'app_test',
      SECRETS_DIR: '/app/secrets/instances',
      REAL_WRITES: 'on',
    });
    expect(config).toMatchObject({
      host: '0.0.0.0',
      port: 4300,
      logLevel: 'debug',
      appDbRole: 'app_test',
      secretsDir: '/app/secrets/instances',
      realWrites: true,
    });
  });

  it('accepts the postgresql:// scheme', () => {
    const url = 'postgresql://simatis:secret@db:5432/simatis';
    expect(loadConfig({ ...BASE, DATABASE_URL: url }).databaseUrl).toBe(url);
  });

  it('names DATABASE_URL when it is missing', () => {
    expect(() => loadConfig({ APP_DB_PASSWORD: 'x' })).toThrow(/DATABASE_URL/);
  });

  it('names APP_DB_PASSWORD when it is missing', () => {
    expect(() => loadConfig({ DATABASE_URL })).toThrow(/APP_DB_PASSWORD/);
  });

  it('rejects a non-Postgres URL', () => {
    expect(() => loadConfig({ ...BASE, DATABASE_URL: 'mysql://user@host/db' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('rejects a URL broken by a special character in the password', () => {
    expect(() =>
      loadConfig({ ...BASE, DATABASE_URL: 'postgres://simatis:ab/cd@db:5432/simatis' }),
    ).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-numeric PORT', () => {
    expect(() => loadConfig({ ...BASE, PORT: 'abc' })).toThrow(/PORT/);
  });

  it('rejects an unknown LOG_LEVEL', () => {
    expect(() => loadConfig({ ...BASE, LOG_LEVEL: 'verbose' })).toThrow(/LOG_LEVEL/);
  });

  it('rejects a role name that is not a plain identifier', () => {
    expect(() => loadConfig({ ...BASE, APP_DB_ROLE: 'app; drop' })).toThrow(/APP_DB_ROLE/);
  });

  it('only enables real writes with REAL_WRITES=on', () => {
    expect(() => loadConfig({ ...BASE, REAL_WRITES: 'yes' })).toThrow(/REAL_WRITES/);
  });
});
