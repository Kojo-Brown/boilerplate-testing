import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const rootDir = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest/setup.ts'],
    exclude: [
      'pact/**',
      'node_modules/**',
      // Playwright specs live under playwright/ and match Vitest's default
      // `*.spec.ts` include glob. They need a real browser and a running app,
      // so they belong to `pnpm test:e2e`, not the unit run.
      'playwright/**',
      // Playwright *component* specs, which bundle and mount a component in a
      // real browser. They match Vitest's default `*.spec.tsx` include glob
      // too, and belong to `pnpm test:ct`. Only the specs: `ct/` also holds
      // `*.jsdom.test.tsx`, which is the same component under Testing Library
      // and is the half of the comparison that runs here.
      'ct/**/*.spec.tsx',
      // Playwright specs that drive a browser against the fixture origin
      // `intercept/server.ts` starts. They match Vitest's default `*.spec.ts`
      // include glob and belong to `pnpm test:intercept` and its own CI job.
      // Only the specs: the rest of `intercept/` — the route table, the
      // wirings, the classifiers, the matrix and the recording audit — is
      // ordinary computation and stays here, so `pnpm test` keeps covering it
      // on a machine with no browser at all.
      'intercept/**/*.spec.ts',
      // Suites that need a container runtime are `*.container.test.ts`
      // wherever they live — `containers/` and `dbisolation/` today. They take
      // minutes and belong to `pnpm test:containers` and its own CI job.
      // Everything else in those directories — the image table, the fixture's
      // naming, the fault catalogue, the README audits — is ordinary
      // computation and stays here, so `pnpm test` keeps covering it on a
      // machine with no Docker at all.
      '**/*.container.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      exclude: [
        '**/*.config.*',
        '**/*.test.*',
        '**/node_modules/**',
        'pact/**',
        'playwright/**',
        // The component-test directory. Its components are exercised by
        // `pnpm test:ct`, which runs in a browser outside this process, so
        // whatever this run covered of them would be the jsdom half of a
        // comparison — a coverage figure that says the opposite of what it
        // looks like.
        'ct/**',
        // The same argument as `ct/`, one directory over: what `intercept/`
        // measures happens in a browser outside this process, so a coverage
        // figure taken here would be of the parts that do not need one.
        'intercept/**/*.spec.ts',
        'intercept/client.ts',
        'intercept/record.ts',
        'intercept/session.ts',
      ],
    },
  },
  resolve: {
    alias: {
      // Must be absolute: a bare '.' is not resolved relative to this config,
      // so `@/vitest/flaky` failed to resolve at import-analysis time.
      '@': rootDir,
    },
  },
})
