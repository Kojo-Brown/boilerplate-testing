import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const rootDir = fileURLToPath(new URL('..', import.meta.url))

// The container suites are their own Vitest project, for the same reason
// `pact/` is: they need a Node environment rather than jsdom, and they need a
// container runtime, which `pnpm test` must never require.
//
// The split is by filename rather than by directory. `*.container.test.ts`
// starts a container and runs here; every other test file is ordinary
// computation and runs in `pnpm test`, so the image table, the fixture's
// naming rules and the README audits are checked on every commit rather than
// only in the job that has a Docker daemon.
//
// The include glob is repository-wide rather than `containers/**` because the
// project is "suites that need a container runtime", not "the containers
// directory". `dbisolation/` is the second directory to qualify: it compares
// database isolation strategies against a real Postgres, and it borrows the
// container `containers/suite.ts` has already started rather than starting a
// second one — which is the arrangement that directory's own matrix argues
// for. A third directory needs no change here.
//
// `singleFork` is the load-bearing option. Vitest would otherwise run each test
// file in its own worker, and each worker would start its own Postgres, Redis
// and Kafka — three times the containers, on a two-core runner, for no extra
// coverage. One fork is what lets `suite.ts` start each store once, lazily, and
// hand the same container to every suite that asks — which is the arrangement
// the directory is about, not merely a way of running it.
export default defineConfig({
  test: {
    include: ['**/*.container.test.ts'],
    environment: 'node',
    globals: true,
    pool: 'forks',
    poolOptions: {
      // `isolate: false` is the other half of it: with isolation on, every
      // test file gets a fresh module registry, so the container cache in
      // `suite.ts` would be per file rather than per run. One fork with one
      // registry is what makes "started once, used by every suite" true.
      forks: { singleFork: true, isolate: false },
    },
    globalSetup: ['./containers/setup.ts'],
    // Kafka is the reason these are minutes rather than seconds: a cold broker
    // takes ~11s to answer, and the residue matrix drains a topic 24 times.
    // `dbisolation/` adds two matrices whose work is done in `beforeAll`, so
    // its hooks are the long ones and its tests read a computed result.
    testTimeout: 180_000,
    hookTimeout: 300_000,
  },
  resolve: {
    alias: {
      '@': rootDir,
    },
  },
})
