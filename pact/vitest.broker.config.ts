import { defineConfig } from 'vitest/config';

// The suites that need a running Pact Broker.
//
// Split from `vitest.config.ts` by filename rather than by directory, so a
// module can hold both kinds side by side: `pipeline/` has a broker-backed
// matrix and half a dozen derivations that need nothing, and both belong next
// to each other.
//
// The timeout is generous because one cell of that matrix is a publish, two
// verifications, two deployment records and two `can-i-deploy` calls, and
// there are 44 of them.
export default defineConfig({
  test: {
    include: ['pact/**/*.broker.test.ts'],
    environment: 'node',
    globals: true,
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
  resolve: {
    alias: { '@': '.' },
  },
});
