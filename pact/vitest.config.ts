import { defineConfig } from 'vitest/config';

// Pact tests require a Node environment and process-forking to spawn
// the native Rust pact binary. Never mix with jsdom-based unit tests.
//
// `*.broker.test.ts` is excluded here and picked up by
// `vitest.broker.config.ts` instead, the same split `containers/` makes for
// `*.container.test.ts`: those suites need a running Pact Broker, which
// `pnpm test:pact` must never require. Everything in this run — the consumer
// contracts, the provider verification, the derivations and the unit tests
// around them — needs nothing but Node.
export default defineConfig({
  test: {
    include: ['pact/**/*.test.ts'],
    exclude: ['pact/**/*.broker.test.ts'],
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
