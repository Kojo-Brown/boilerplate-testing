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
