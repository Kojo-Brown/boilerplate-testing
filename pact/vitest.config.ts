import { defineConfig } from 'vitest/config';

// Pact tests require a Node environment and process-forking to spawn
// the native Rust pact binary. Never mix with jsdom-based unit tests.
export default defineConfig({
  test: {
    include: ['pact/**/*.test.ts'],
    environment: 'node',
    globals: true,
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    testTimeout: 30_000,
  },
  resolve: {
    alias: { '@': '.' },
  },
});
