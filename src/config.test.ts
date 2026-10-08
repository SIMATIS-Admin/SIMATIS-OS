import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const DATABASE_URL = 'postgres://simatis:secret@127.0.0.1:5433/simatis';

describe('loadConfig', () => {
  it('applies defaults when only DATABASE_URL is set', () => {
    expect(loadConfig({ DATABASE_URL })).toEqual({
      databaseUrl: DATABASE_URL,
      host: '127.0.0.1',
      port: 3000,
      logLevel: 'info',
    });
  });

  it('reads explicit values', () => {
    const config = loadConfig({ DATABASE_URL, HOST: '0.0.0.0', PORT: '4300', LOG_LEVEL: 'debug' });
    expect(config).toMatchObject({ host: '0.0.0.0', port: 4300, logLevel: 'debug' });
  });

  it('accepts the postgresql:// scheme', () => {
    const url = 'postgresql://simatis:secret@db:5432/simatis';
    expect(loadConfig({ DATABASE_URL: url }).databaseUrl).toBe(url);
  });

  it('names DATABASE_URL when it is missing', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-Postgres URL', () => {
    expect(() => loadConfig({ DATABASE_URL: 'mysql://user@host/db' })).toThrow(/DATABASE_URL/);
  });

  it('rejects a URL broken by a special character in the password', () => {
    expect(() => loadConfig({ DATABASE_URL: 'postgres://simatis:ab/cd@db:5432/simatis' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('rejects a non-numeric PORT', () => {
    expect(() => loadConfig({ DATABASE_URL, PORT: 'abc' })).toThrow(/PORT/);
  });

  it('rejects an unknown LOG_LEVEL', () => {
    expect(() => loadConfig({ DATABASE_URL, LOG_LEVEL: 'verbose' })).toThrow(/LOG_LEVEL/);
  });
});
