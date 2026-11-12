import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts', 'web/src/**/*.test.{ts,tsx}'],
    globalSetup: ['test/postgres.ts'],
    // Each test file creates and migrates its own database: slow on a loaded machine. Several tests
    // set theirs up inside the test itself, so the delay of a test is as long as the one of a hook,
    // otherwise they expire at 5 s whenever the machine is busy (dev server, Docker, other sessions).
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
