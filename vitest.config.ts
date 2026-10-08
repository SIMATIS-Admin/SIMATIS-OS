import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts', 'web/src/**/*.test.{ts,tsx}'],
    globalSetup: ['test/postgres.ts'],
    // Each test file creates and migrates its own database: slow on a loaded machine.
    hookTimeout: 60_000,
  },
});
