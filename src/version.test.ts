import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readVersion } from './version.js';

describe('readVersion', () => {
  it('returns the version from package.json', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    expect(readVersion()).toBe(pkg.version);
  });
});
